"""Triggered by API Gateway. Takes a resume (PDF, via Textract) and/or pasted
skills plus filters, embeds the profile, queries the Bedrock Knowledge Base
for matching job postings, and returns a ranked list. Works for guests (no
auth token required). Does not call Claude — see analysis_lambda for the
on-demand per-job explanation step.
"""
import base64
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config
from botocore.exceptions import ClientError
from dotenv import load_dotenv

from filters import build_metadata_filter, job_matches_filters
from textract import extract_text_from_pdf

load_dotenv('.env')
BUCKET_NAME = os.getenv('BUCKET_NAME')
BEDROCK_KB_ID = os.getenv('BEDROCK_KB_ID')
UNINTERESTED_TABLE_NAME = os.getenv('UNINTERESTED_TABLE_NAME')

MAX_RESULTS = 50  # frontend reveals these 10 at a time via "Load more"
BROWSE_FETCH_WORKERS = 20  # concurrency for per-job embedding calls (see score_jobs_against_profile)

# Default boto3 connection pool (10) is smaller than BROWSE_FETCH_WORKERS,
# so concurrent S3 fetches were constantly exhausting and recreating
# connections ("Connection pool is full, discarding connection" in the
# logs) - observed live after the concurrency fix below, costing real time.
s3_client = boto3.client('s3', config=Config(max_pool_connections=BROWSE_FETCH_WORKERS * 2))
agent_runtime = boto3.client('bedrock-agent-runtime')
bedrock_runtime = boto3.client('bedrock-runtime', config=Config(max_pool_connections=BROWSE_FETCH_WORKERS * 2))
dynamodb = boto3.resource('dynamodb')
uninterested_table = dynamodb.Table(UNINTERESTED_TABLE_NAME) if UNINTERESTED_TABLE_NAME else None

EMBED_MODEL_ID = 'amazon.titan-embed-text-v2:0'  # same model the KB itself uses
EMBED_CACHE_PREFIX = 'embed-cache'  # S3-backed, so it survives cold starts


def job_id_from_uri(uri):
    return uri.rsplit('/', 1)[-1].removesuffix('.json')


def embed_text(text):
    response = bedrock_runtime.invoke_model(
        modelId=EMBED_MODEL_ID,
        body=json.dumps({'inputText': text}),
        contentType='application/json',
        accept='application/json',
    )
    return json.loads(response['body'].read())['embedding']


def get_cached_embedding(cache_key, text):
    """S3-backed cache keyed by content hash (profile text) or job_id (job
    postings are effectively immutable once ingested) - repeat searches for
    the same resume, and repeat sightings of the same job across different
    searchers, skip the Titan call entirely."""
    s3_key = f'{EMBED_CACHE_PREFIX}/{cache_key}.json'
    try:
        obj = s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
        return json.loads(obj['Body'].read())['embedding']
    except s3_client.exceptions.NoSuchKey:
        embedding = embed_text(text)
        s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=json.dumps({'embedding': embedding}).encode('utf-8'),
            ContentType='application/json',
        )
        return embedding


def cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return max(0.0, min(1.0, dot / (norm_a * norm_b)))


def job_embedding_text(job):
    parts = [job.get('title') or '', job.get('company') or '', job.get('location') or '', job.get('description') or '']
    return '\n'.join(p for p in parts if p)[:20000]


def score_jobs_against_profile(jobs, profile_text):
    """Scores every job in `jobs` against the resume, independent of
    whatever the Bedrock KB's semantic retrieve() would have ranked - used
    for the text-filter search path, where inclusion is already decided by
    substring match and every included job needs a score for the frontend
    to show it (see job_matches_filters/browse_jobs)."""
    profile_hash = hashlib.sha256(profile_text.encode('utf-8')).hexdigest()
    profile_embedding = get_cached_embedding(f'profile/{profile_hash}', profile_text)

    def score_one(job):
        job_embedding = get_cached_embedding(f'job/{job["job_id"]}', job_embedding_text(job))
        return job['job_id'], cosine_similarity(profile_embedding, job_embedding)

    scores = {}
    with ThreadPoolExecutor(max_workers=BROWSE_FETCH_WORKERS) as pool:
        for job_id, score in pool.map(score_one, jobs):
            scores[job_id] = score
    return scores


JOBS_MANIFEST_KEY = 'manifest/jobs.json'
_manifest_cache = None  # populated at most once per warm Lambda execution env


def load_jobs_manifest():
    """One JSON object keyed by job_id, kept current by ingestion_lambda on
    every nightly run - a single GetObject standing in for what used to be
    up to hundreds of individual jobs/<id>.json fetches per search. Cached
    per warm container since it only changes once a day."""
    global _manifest_cache
    if _manifest_cache is not None:
        return _manifest_cache
    try:
        obj = s3_client.get_object(Bucket=BUCKET_NAME, Key=JOBS_MANIFEST_KEY)
        _manifest_cache = json.loads(obj['Body'].read())
    except s3_client.exceptions.NoSuchKey:
        _manifest_cache = {}
    return _manifest_cache


def browse_jobs(filters):
    """No profile text was given, so there's nothing to semantically search
    against. Filter the manifest directly in memory instead of listing and
    fetching job bodies from S3."""
    matches = [job for job in load_jobs_manifest().values() if job_matches_filters(job, filters)]
    matches.sort(key=lambda j: j.get('ingested_at') or '', reverse=True)
    return matches[:MAX_RESULTS], {}


LOCATIONS_MANIFEST_KEY = 'manifest/locations.json'
MAX_LOCATION_SUGGESTIONS = 8


def autocomplete_locations(query):
    try:
        obj = s3_client.get_object(Bucket=BUCKET_NAME, Key=LOCATIONS_MANIFEST_KEY)
        locations = json.loads(obj['Body'].read())
    except s3_client.exceptions.NoSuchKey:
        locations = []

    query = query.lower()
    matches = [loc for loc in locations if query in loc.lower()]
    return matches[:MAX_LOCATION_SUGGESTIONS]


def optional_user_id(event):
    """This route has no authorizer - guests search too - so a logged-in
    caller identifies themselves by sending their id_token as a normal
    Authorization header, which this route reads but never requires. This
    is a best-effort, UNVERIFIED decode of the JWT's claims (no signature
    check) purely to personalize which jobs get excluded from search
    results - job listings aren't sensitive, so a spoofed sub only ever
    mispersonalizes someone's own results, never exposes or corrupts
    anything. Returns None on any missing/malformed token."""
    headers = {k.lower(): v for k, v in (event.get('headers') or {}).items()}
    auth_header = headers.get('authorization', '')
    if not auth_header.lower().startswith('bearer '):
        return None
    token = auth_header[7:]
    try:
        payload_segment = token.split('.')[1]
        padded = payload_segment + '=' * (-len(payload_segment) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded))
        return claims.get('sub')
    except Exception:
        return None


def fetch_uninterested_job_ids(user_id):
    if not user_id or uninterested_table is None:
        return set()
    try:
        response = uninterested_table.query(KeyConditionExpression=Key('user_id').eq(user_id))
        return {item['job_id'] for item in response.get('Items', [])}
    except ClientError as e:
        print(f'could not fetch uninterested jobs: {e}')
        return set()


def handler(event, context):
    body = json.loads(event.get('body') or '{}')

    location_query = body.get('location_query')
    if location_query is not None:
        return {
            'statusCode': 200,
            'body': json.dumps({'suggestions': autocomplete_locations(location_query)}),
        }

    resume_b64 = body.get('resume_pdf_base64')
    skills_text = body.get('skills_text')
    filters = body.get('filters') or {}

    resume_text = ''
    if resume_b64:
        try:
            pdf_bytes = base64.b64decode(resume_b64)
            resume_text = extract_text_from_pdf(pdf_bytes)
        except ClientError as e:
            print(f'Textract call failed: {e}')
            return {'statusCode': 502, 'body': json.dumps({'error': 'text extraction service failed'})}
        except Exception as e:
            print(f'could not read PDF: {e}')
            return {'statusCode': 422, 'body': json.dumps({'error': 'could not read PDF'})}

    profile_text = '\n'.join(t for t in [resume_text, skills_text] if t).strip()

    # title/location are substring queries, e.g. "abb" for AbbVie - an exact
    # user intent that semantic vector search can silently drop (a job can
    # rank outside the top N results the KB's retrieve() returns for a given
    # resume, even though its title/company literally contains the query).
    # So when either is set, substring match is authoritative for which jobs
    # are included; the resume (if any) only reorders that set by relevance,
    # it never removes a textually-matching job from it.
    has_text_filter = bool(filters.get('title') or filters.get('location'))

    scores_by_job_id = {}
    if has_text_filter:
        jobs, _ = browse_jobs(filters)
        if profile_text and jobs:
            # Score every text-matched job directly (embed + cosine) instead
            # of asking the KB's retrieve() to rank them - retrieve() only
            # scores whatever it decided to semantically retrieve, which is
            # exactly the gap that made match_score come back null for jobs
            # substring-matched here but outside its top N.
            scores_by_job_id = score_jobs_against_profile(jobs, profile_text)
            jobs.sort(key=lambda j: scores_by_job_id.get(j['job_id'], -1), reverse=True)
    elif profile_text:
        metadata_filter = build_metadata_filter(filters)
        retrieval_configuration = {'vectorSearchConfiguration': {'numberOfResults': MAX_RESULTS}}
        if metadata_filter:
            retrieval_configuration['vectorSearchConfiguration']['filter'] = metadata_filter

        response = agent_runtime.retrieve(
            knowledgeBaseId=BEDROCK_KB_ID,
            retrievalQuery={'text': profile_text[:20000]},
            retrievalConfiguration=retrieval_configuration,
        )

        manifest = load_jobs_manifest()
        seen_job_ids = []
        for result in response['retrievalResults']:
            job_id = job_id_from_uri(result['location']['s3Location']['uri'])
            if job_id not in scores_by_job_id:
                scores_by_job_id[job_id] = result.get('score', 0)
            if job_id not in seen_job_ids:
                seen_job_ids.append(job_id)

        jobs = [manifest[job_id] for job_id in seen_job_ids if job_id in manifest]
    else:
        jobs, scores_by_job_id = browse_jobs(filters)

    excluded_job_ids = fetch_uninterested_job_ids(optional_user_id(event))
    if excluded_job_ids:
        jobs = [job for job in jobs if job['job_id'] not in excluded_job_ids]

    matches = []
    for job in jobs:
        score = scores_by_job_id.get(job['job_id'])
        matches.append({
            'job_id': job['job_id'],
            'title': job['title'],
            'company': job['company'],
            'location': job['location'],
            'remote': job['remote'],
            'salary_min': job['salary_min'],
            'salary_max': job['salary_max'],
            'listing_url': job['listing_url'],
            'match_score': round(score * 100) if score is not None else None,
            'ingested_at': job.get('ingested_at'),
        })

    return {
        'statusCode': 200,
        'body': json.dumps({'profile_text': profile_text, 'matches': matches}),
    }

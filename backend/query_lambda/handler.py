"""Triggered by API Gateway. Takes a resume (PDF, via Textract) and/or pasted
skills plus filters, embeds the profile, queries the Bedrock Knowledge Base
for matching job postings, and returns a ranked list. Works for guests (no
auth token required). Does not call Claude — see analysis_lambda for the
on-demand per-job explanation step.
"""
import base64
import json
import os
from concurrent.futures import ThreadPoolExecutor

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv

from filters import build_metadata_filter, job_matches_filters
from textract import extract_text_from_pdf

load_dotenv('.env')
BUCKET_NAME = os.getenv('BUCKET_NAME')
BEDROCK_KB_ID = os.getenv('BEDROCK_KB_ID')

s3_client = boto3.client('s3')
agent_runtime = boto3.client('bedrock-agent-runtime')

MAX_RESULTS = 50  # frontend reveals these 10 at a time via "Load more"
BROWSE_SCAN_LIMIT = 300  # cap how many candidates we'll fetch in browse mode
BROWSE_FETCH_WORKERS = 20


def job_id_from_uri(uri):
    return uri.rsplit('/', 1)[-1].removesuffix('.json')


def fetch_job(job_id):
    obj = s3_client.get_object(Bucket=BUCKET_NAME, Key=f'jobs/{job_id}.json')
    return json.loads(obj['Body'].read())


def list_job_ids_by_recency():
    """Sort by S3 LastModified (a close proxy for ingested_at) using only
    the list response, so we don't need to fetch every job body just to
    know the fetch order."""
    entries = []
    paginator = s3_client.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=BUCKET_NAME, Prefix='jobs/'):
        for obj in page.get('Contents', []):
            key = obj['Key']
            if key.endswith('.json') and not key.endswith('.metadata.json'):
                entries.append((obj['LastModified'], job_id_from_uri(key)))
    entries.sort(key=lambda e: e[0], reverse=True)
    return [job_id for _, job_id in entries]


def fetch_jobs_concurrently(job_ids):
    jobs = []
    with ThreadPoolExecutor(max_workers=BROWSE_FETCH_WORKERS) as pool:
        for job in pool.map(_fetch_job_or_none, job_ids):
            if job is not None:
                jobs.append(job)
    return jobs


def _fetch_job_or_none(job_id):
    try:
        return fetch_job(job_id)
    except s3_client.exceptions.NoSuchKey:
        return None


def browse_jobs(filters):
    """No profile text was given, so there's nothing to semantically search
    against. List jobs directly from S3 (cheap), fetch candidate bodies
    concurrently in recency order, and stop once we have enough matches
    or hit the scan cap, so this stays fast even with a large bucket."""
    matches = []
    job_ids = list_job_ids_by_recency()[:BROWSE_SCAN_LIMIT]

    batch_size = BROWSE_FETCH_WORKERS
    for i in range(0, len(job_ids), batch_size):
        batch = job_ids[i:i + batch_size]
        for job in fetch_jobs_concurrently(batch):
            if job_matches_filters(job, filters):
                matches.append(job)
        if len(matches) >= MAX_RESULTS:
            break

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

    scores_by_job_id = {}
    if profile_text:
        metadata_filter = build_metadata_filter(filters)
        retrieval_configuration = {'vectorSearchConfiguration': {'numberOfResults': MAX_RESULTS}}
        if metadata_filter:
            retrieval_configuration['vectorSearchConfiguration']['filter'] = metadata_filter

        response = agent_runtime.retrieve(
            knowledgeBaseId=BEDROCK_KB_ID,
            retrievalQuery={'text': profile_text[:20000]},
            retrievalConfiguration=retrieval_configuration,
        )

        seen_job_ids = []
        for result in response['retrievalResults']:
            job_id = job_id_from_uri(result['location']['s3Location']['uri'])
            if job_id not in scores_by_job_id:
                scores_by_job_id[job_id] = result.get('score', 0)
            if job_id not in seen_job_ids:
                seen_job_ids.append(job_id)

        jobs = []
        for job_id in seen_job_ids:
            try:
                jobs.append(fetch_job(job_id))
            except s3_client.exceptions.NoSuchKey:
                print(f'skipping missing job {job_id}')
    else:
        jobs, scores_by_job_id = browse_jobs(filters)

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

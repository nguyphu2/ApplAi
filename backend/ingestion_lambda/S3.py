import boto3
import json
import os
from dotenv import load_dotenv


load_dotenv('.env')
s3_bucket = os.getenv('BUCKET_NAME')

s3_client = boto3.client('s3')


SALARY_UNKNOWN_SENTINEL = 10_000_000


def list_existing_job_ids():
    """Job IDs already uploaded from a prior run, so the caller can skip
    re-uploading unchanged postings instead of rewriting all of them
    every run."""
    ids = set()
    paginator = s3_client.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=s3_bucket, Prefix='jobs/'):
        for obj in page.get('Contents', []):
            key = obj['Key']
            if key.endswith('.json') and not key.endswith('.metadata.json'):
                job_id = key.removeprefix('jobs/').removesuffix('.json')
                ids.add(job_id)
    return ids


def upload(job):
    key = f"jobs/{job['job_id']}.json"

    s3_client.put_object(
        Bucket=s3_bucket,
        Key=key,
        Body=json.dumps(job).encode('utf-8'),
        ContentType='application/json',
    )

    salary_max = job['salary_max'] if job['salary_max'] is not None else SALARY_UNKNOWN_SENTINEL
    metadata = {
        'metadataAttributes': {
            'remote': {
                'value': {'type': 'BOOLEAN', 'booleanValue': job['remote']},
                'includeForEmbedding': False,
            },
            'location': {
                'value': {'type': 'STRING', 'stringValue': job['location'].lower()},
                'includeForEmbedding': False,
            },
            'title': {
                'value': {'type': 'STRING', 'stringValue': job['title'].lower()},
                'includeForEmbedding': False,
            },
            'salary_max': {
                'value': {'type': 'NUMBER', 'numberValue': salary_max},
                'includeForEmbedding': False,
            },
        }
    }

    s3_client.put_object(
        Bucket=s3_bucket,
        Key=f"{key}.metadata.json",
        Body=json.dumps(metadata).encode('utf-8'),
        ContentType='application/json',
    )

    return f"s3://{s3_bucket}/{key}"


def upload_locations_manifest(locations):
    """Writes the deduped, sorted list of individual job locations to a
    single small S3 object so query_lambda can serve autocomplete
    suggestions with one cheap GetObject instead of scanning every job."""
    s3_client.put_object(
        Bucket=s3_bucket,
        Key='manifest/locations.json',
        Body=json.dumps(sorted(locations)).encode('utf-8'),
        ContentType='application/json',
    )


JOBS_MANIFEST_KEY = 'manifest/jobs.json'


def load_jobs_manifest():
    try:
        obj = s3_client.get_object(Bucket=s3_bucket, Key=JOBS_MANIFEST_KEY)
        return json.loads(obj['Body'].read())
    except s3_client.exceptions.NoSuchKey:
        return {}


def upload_jobs_manifest(manifest):
    """One JSON object keyed by job_id, mirroring every job's S3 body - lets
    query_lambda filter/serve listings from a single GetObject instead of
    individually fetching hundreds of jobs/<id>.json files per search."""
    s3_client.put_object(
        Bucket=s3_bucket,
        Key=JOBS_MANIFEST_KEY,
        Body=json.dumps(manifest).encode('utf-8'),
        ContentType='application/json',
    )


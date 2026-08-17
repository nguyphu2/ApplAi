"""Triggered by EventBridge Scheduler. Pulls internship postings from
SimplifyJobs' public listings.json, writes normalized JSON to S3 for any
job not already uploaded from a prior run, then starts a Bedrock Knowledge
Base ingestion job so the new postings get embedded and become searchable.

Previously sourced from Adzuna, whose listing_url is a tracking redirect
that gates the real destination behind bot-detected client-side JS. Switched
to SimplifyJobs because its `url` field is already the real, direct
application page - no redirect to resolve.

Previously re-uploaded every active job on every run (a full rebuild each
time), which meant re-writing ~1,700 unchanged postings daily and blew past
the function's timeout before it ever reached the Bedrock sync call. Now
diffs against what's already in S3 and only uploads what's new.
"""
import os
import requests
from dotenv import load_dotenv
from normalize import normalize_job
from S3 import upload, upload_locations_manifest, list_existing_job_ids
import boto3


load_dotenv('.env')
BEDROCK_KB_ID = os.getenv('BEDROCK_KB_ID')
BEDROCK_DATA_SOURCE_ID = os.getenv('BEDROCK_DATA_SOURCE_ID')

client = boto3.client('bedrock-agent')

LISTINGS_URL = (
    'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships'
    '/dev/.github/scripts/listings.json'
)


def handler(event, context):
    response = requests.get(LISTINGS_URL, timeout=30)
    response.raise_for_status()
    raw_jobs = response.json()

    active_jobs = [j for j in raw_jobs if j.get('active') and j.get('is_visible', True)]
    normalized_jobs = [normalize_job(job) for job in active_jobs]

    existing_ids = list_existing_job_ids()
    new_jobs = [j for j in normalized_jobs if j['job_id'] not in existing_ids]

    for j in new_jobs:
        upload(j)

    locations = {loc for j in normalized_jobs for loc in j['location'].split('; ') if loc}
    upload_locations_manifest(locations)

    if not new_jobs:
        return {'ingestionJobId': None, 'status': 'SKIPPED_NO_NEW_JOBS', 'jobsUploaded': 0}

    ingestion_job = client.start_ingestion_job(
        knowledgeBaseId=BEDROCK_KB_ID,
        dataSourceId=BEDROCK_DATA_SOURCE_ID,
        description='Sync data source'
    )['ingestionJob']

    return {
        'ingestionJobId': ingestion_job['ingestionJobId'],
        'status': ingestion_job['status'],
        'jobsUploaded': len(new_jobs),
    }

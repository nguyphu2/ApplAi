"""Triggered by EventBridge Scheduler. Pulls job postings from Adzuna, writes
normalized JSON to S3, then starts a Bedrock Knowledge Base ingestion job so
the new postings get embedded and become searchable.
"""
import os
import requests
from dotenv import load_dotenv
from normalize import normalize_job
from S3 import upload
import boto3


load_dotenv('adzuna.env')
api_id = os.getenv('APP_ID')
app_key = os.getenv('APP_KEYS')
client = boto3.client('bedrock-agent')
load_dotenv('.env')
BEDROCK_KB_ID = os.getenv('BEDROCK_KB_ID')
BEDROCK_DATA_SOURCE_ID = os.getenv('BEDROCK_DATA_SOURCE_ID')

PAGE = 1
MAX_DAYS_OLD = 30

SEARCH_TERMS = [
    "product manager", "product manager intern", "product manager new grad",
    "machine learning", "machine learning intern", "machine learning new grad",
    "data scientist", "data scientist intern", "data scientist new grad",
    "software engineer", "software engineer intern", "software engineer new grad",
    "data analyst", "data analyst intern", "data analyst new grad",
    "AI", "AI intern", "AI new grad",
    "AI/ML", "AI/ML intern", "AI/ML new grad",
]


def handler(event, context):
    jobs = []
    for search_term in SEARCH_TERMS:
        response = requests.get(
            f"https://api.adzuna.com/v1/api/jobs/us/search/{PAGE}",
            params={
                "app_id": api_id,
                "app_key": app_key,
                "results_per_page": 50,
                "what": search_term,
                "max_days_old": MAX_DAYS_OLD,
            },
        )
        response.raise_for_status()
        jobs.extend(response.json()["results"])

    unique_jobs = {job["id"]: job for job in jobs}.values()
    normalized_jobs = [normalize_job(job) for job in unique_jobs]

    for j in normalized_jobs:
        upload(j)

    ingestion_job = client.start_ingestion_job(
        knowledgeBaseId=BEDROCK_KB_ID,
        dataSourceId=BEDROCK_DATA_SOURCE_ID,
        description='Sync data source'
    )['ingestionJob']

    return {
        'ingestionJobId': ingestion_job['ingestionJobId'],
        'status': ingestion_job['status'],
        'jobsUploaded': len(normalized_jobs),
    }

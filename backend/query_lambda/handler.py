"""Triggered by API Gateway. Takes a resume (PDF, via Textract) and/or pasted
skills plus filters, embeds the profile, queries the Bedrock Knowledge Base
for matching job postings, and returns a ranked list. Works for guests (no
auth token required). Does not call Claude — see analysis_lambda for the
on-demand per-job explanation step.
"""
import base64
import json
import os

import boto3
from dotenv import load_dotenv

from filters import build_metadata_filter
from textract import extract_text_from_pdf

load_dotenv('.env')
BUCKET_NAME = os.getenv('BUCKET_NAME')
BEDROCK_KB_ID = os.getenv('BEDROCK_KB_ID')

s3_client = boto3.client('s3')
agent_runtime = boto3.client('bedrock-agent-runtime')

MAX_RESULTS = 10


def job_id_from_uri(uri):
    return uri.rsplit('/', 1)[-1].removesuffix('.json')


def fetch_job(job_id):
    obj = s3_client.get_object(Bucket=BUCKET_NAME, Key=f'jobs/{job_id}.json')
    return json.loads(obj['Body'].read())


def handler(event, context):
    body = json.loads(event.get('body') or '{}')
    resume_b64 = body.get('resume_pdf_base64')
    skills_text = body.get('skills_text')
    filters = body.get('filters') or {}

    if not resume_b64 and not skills_text:
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'resume_pdf_base64 or skills_text is required'}),
        }

    resume_text = ''
    if resume_b64:
        try:
            pdf_bytes = base64.b64decode(resume_b64)
            resume_text = extract_text_from_pdf(pdf_bytes)
        except Exception as e:
            return {'statusCode': 422, 'body': json.dumps({'error': f'could not read PDF: {e}'})}

    profile_text = '\n'.join(t for t in [resume_text, skills_text] if t).strip()
    if not profile_text:
        return {
            'statusCode': 422,
            'body': json.dumps({'error': 'no text could be extracted from the resume or skills text'}),
        }

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
        if job_id not in seen_job_ids:
            seen_job_ids.append(job_id)

    matches = []
    for job_id in seen_job_ids:
        job = fetch_job(job_id)
        matches.append({
            'job_id': job['job_id'],
            'title': job['title'],
            'company': job['company'],
            'location': job['location'],
            'remote': job['remote'],
            'salary_min': job['salary_min'],
            'salary_max': job['salary_max'],
            'listing_url': job['listing_url'],
        })

    return {
        'statusCode': 200,
        'body': json.dumps({'profile_text': profile_text, 'matches': matches}),
    }

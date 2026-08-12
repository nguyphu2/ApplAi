"""Triggered by API Gateway. Takes a job_id and the profile_text already
extracted by query_lambda's search step, and generates a Claude match
explanation + skill-gap analysis for that one specific job. Runs on demand,
only when a user clicks "job match analysis" on a specific result, not
automatically for every search result.
"""
import json
import os

import boto3
from dotenv import load_dotenv

load_dotenv('.env')
BUCKET_NAME = os.getenv('BUCKET_NAME')
CLAUDE_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'

s3_client = boto3.client('s3')
bedrock_runtime = boto3.client('bedrock-runtime')


def fetch_job(job_id):
    obj = s3_client.get_object(Bucket=BUCKET_NAME, Key=f'jobs/{job_id}.json')
    return json.loads(obj['Body'].read())


def build_prompt(profile_text, job):
    return f"""You are helping a job seeker evaluate one specific job posting against their resume/skills.

Resume/skills:
{profile_text}

Job posting:
Title: {job['title']}
Company: {job['company']}
Description: {job['description']}

Respond with ONLY a JSON object in this exact shape, no other text before or after it:
{{"explanation": "2-3 sentences on why this is or isn't a good match", "skill_gaps": ["skill 1", "skill 2"]}}
If there are no meaningful skill gaps, return an empty list for skill_gaps."""


def handler(event, context):
    body = json.loads(event.get('body') or '{}')
    job_id = body.get('job_id')
    profile_text = body.get('profile_text')

    if not job_id or not profile_text:
        return {'statusCode': 400, 'body': json.dumps({'error': 'job_id and profile_text are required'})}

    try:
        job = fetch_job(job_id)
    except s3_client.exceptions.NoSuchKey:
        return {'statusCode': 404, 'body': json.dumps({'error': f'job {job_id} not found'})}

    prompt = build_prompt(profile_text, job)

    try:
        response = bedrock_runtime.invoke_model(
            modelId=CLAUDE_MODEL_ID,
            body=json.dumps({
                'anthropic_version': 'bedrock-2023-05-31',
                'max_tokens': 500,
                'messages': [{'role': 'user', 'content': prompt}],
            }),
        )
        result = json.loads(response['body'].read())
        claude_text = result['content'][0]['text']
        parsed = json.loads(claude_text)
    except Exception as e:
        return {'statusCode': 502, 'body': json.dumps({'error': f'analysis failed: {e}'})}

    return {
        'statusCode': 200,
        'body': json.dumps({
            'job_id': job_id,
            'explanation': parsed['explanation'],
            'skill_gaps': parsed['skill_gaps'],
        }),
    }

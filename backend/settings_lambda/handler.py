"""Triggered by API Gateway, behind a Cognito JWT authorizer. Reads or writes
the logged-in user's saved preferences (filters, skills text, uploaded
resumes) in DynamoDB, keyed by the Cognito user ID from the validated token.

PUT is a partial read-modify-write: the caller sends only the keys it wants
to change (skills_text, filters, add_resume, remove_resume_id,
active_resume_ids), so the frontend can save the skills textarea, upload a
resume, remove a resume, or change which resumes are active for search as
independent actions without clobbering the rest of the saved profile.
"""
import base64
import json
import os
import uuid
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv

from textract import extract_text_from_pdf

load_dotenv('.env')
TABLE_NAME = os.getenv('SETTINGS_TABLE_NAME')
BUCKET_NAME = os.getenv('BUCKET_NAME')
RESUME_URL_EXPIRY_SECONDS = 900

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(TABLE_NAME)
s3_client = boto3.client('s3')


def get_user_id(event):
    return event['requestContext']['authorizer']['jwt']['claims']['sub']


def resume_pdf_key(user_id, resume_id):
    return f'resumes/{user_id}/{resume_id}.pdf'


def get_item(user_id):
    response = table.get_item(Key={'user_id': user_id})
    item = response.get('Item', {})
    return {
        'skills_text': item.get('skills_text', ''),
        'filters': item.get('filters', {}),
        'resumes': item.get('resumes', []),
        'active_resume_ids': item.get('active_resume_ids', []),
        'profile_info': item.get('profile_info', {}),
    }


def with_resume_urls(user_id, item):
    """Adds a short-lived presigned S3 URL to each resume for the API
    response only - never persisted to DynamoDB, since the URL expires and
    the S3 key is already fully derivable from user_id + resume id."""
    return {
        **item,
        'resumes': [
            {
                **r,
                'pdf_url': s3_client.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': BUCKET_NAME, 'Key': resume_pdf_key(user_id, r['id'])},
                    ExpiresIn=RESUME_URL_EXPIRY_SECONDS,
                ),
            }
            for r in item['resumes']
        ],
    }


def handler(event, context):
    user_id = get_user_id(event)
    method = event['requestContext']['http']['method']

    if method == 'GET':
        try:
            return {'statusCode': 200, 'body': json.dumps(with_resume_urls(user_id, get_item(user_id)))}
        except ClientError as e:
            print(f'DynamoDB get_item failed: {e}')
            return {'statusCode': 502, 'body': json.dumps({'error': 'settings service failed'})}

    if method == 'PUT':
        body = json.loads(event.get('body') or '{}')
        try:
            item = get_item(user_id)

            if 'skills_text' in body:
                item['skills_text'] = body['skills_text']

            if 'filters' in body:
                item['filters'] = body['filters']

            if 'profile_info' in body:
                item['profile_info'] = body['profile_info']

            add_resume = body.get('add_resume')
            if add_resume:
                try:
                    pdf_bytes = base64.b64decode(add_resume['resume_pdf_base64'])
                    text = extract_text_from_pdf(pdf_bytes)
                except Exception as e:
                    print(f'could not read resume PDF: {e}')
                    return {'statusCode': 422, 'body': json.dumps({'error': 'could not read PDF'})}
                resume_id = str(uuid.uuid4())
                s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=resume_pdf_key(user_id, resume_id),
                    Body=pdf_bytes,
                    ContentType='application/pdf',
                )
                item['resumes'].append({
                    'id': resume_id,
                    'filename': add_resume.get('filename', 'resume.pdf'),
                    'text': text,
                    'uploaded_at': datetime.now(timezone.utc).isoformat(),
                })

            remove_resume_id = body.get('remove_resume_id')
            if remove_resume_id:
                item['resumes'] = [r for r in item['resumes'] if r['id'] != remove_resume_id]
                item['active_resume_ids'] = [
                    rid for rid in item['active_resume_ids'] if rid != remove_resume_id
                ]
                try:
                    s3_client.delete_object(Bucket=BUCKET_NAME, Key=resume_pdf_key(user_id, remove_resume_id))
                except ClientError as e:
                    print(f'could not delete resume PDF from S3: {e}')

            if 'active_resume_ids' in body:
                valid_ids = {r['id'] for r in item['resumes']}
                item['active_resume_ids'] = [
                    rid for rid in body['active_resume_ids'] if rid in valid_ids
                ]

            table.put_item(Item={'user_id': user_id, **item})
            return {'statusCode': 200, 'body': json.dumps(with_resume_urls(user_id, item))}
        except ClientError as e:
            print(f'DynamoDB put_item failed: {e}')
            return {'statusCode': 502, 'body': json.dumps({'error': 'settings service failed'})}

    return {'statusCode': 405, 'body': json.dumps({'error': 'method not allowed'})}

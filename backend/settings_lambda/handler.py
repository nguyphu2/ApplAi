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
import io
import json
import os
import uuid
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError
from docx import Document
from dotenv import load_dotenv

load_dotenv('.env')
TABLE_NAME = os.getenv('SETTINGS_TABLE_NAME')
BUCKET_NAME = os.getenv('BUCKET_NAME')
RESUME_URL_EXPIRY_SECONDS = 900

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(TABLE_NAME)
s3_client = boto3.client('s3')


def get_user_id(event):
    return event['requestContext']['authorizer']['jwt']['claims']['sub']


def resume_file_key(user_id, resume_id, file_type='pdf'):
    extension = 'docx' if file_type == 'docx' else 'pdf'
    return f'resumes/{user_id}/{resume_id}.{extension}'


def extract_docx_text(docx_bytes):
    document = Document(io.BytesIO(docx_bytes))
    return '\n'.join(p.text for p in document.paragraphs if p.text.strip())


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
                'file_url': s3_client.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': BUCKET_NAME, 'Key': resume_file_key(user_id, r['id'], r.get('file_type', 'pdf'))},
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
                    docx_bytes = base64.b64decode(add_resume['resume_docx_base64'])
                    text = extract_docx_text(docx_bytes)
                except Exception as e:
                    print(f'could not read resume DOCX: {e}')
                    return {'statusCode': 422, 'body': json.dumps({'error': 'could not read DOCX'})}
                resume_id = str(uuid.uuid4())
                s3_client.put_object(
                    Bucket=BUCKET_NAME,
                    Key=resume_file_key(user_id, resume_id, 'docx'),
                    Body=docx_bytes,
                    ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                )
                item['resumes'].append({
                    'id': resume_id,
                    'filename': add_resume.get('filename', 'resume.docx'),
                    'text': text,
                    'file_type': 'docx',
                    'uploaded_at': datetime.now(timezone.utc).isoformat(),
                })

            remove_resume_id = body.get('remove_resume_id')
            if remove_resume_id:
                removed = next((r for r in item['resumes'] if r['id'] == remove_resume_id), None)
                item['resumes'] = [r for r in item['resumes'] if r['id'] != remove_resume_id]
                item['active_resume_ids'] = [
                    rid for rid in item['active_resume_ids'] if rid != remove_resume_id
                ]
                if removed:
                    try:
                        s3_client.delete_object(
                            Bucket=BUCKET_NAME,
                            Key=resume_file_key(user_id, remove_resume_id, removed.get('file_type', 'pdf')),
                        )
                    except ClientError as e:
                        print(f'could not delete resume file from S3: {e}')

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

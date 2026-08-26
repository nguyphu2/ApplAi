"""Triggered by API Gateway, behind a Cognito JWT authorizer. Tracks which
jobs the logged-in user has applied to and their status through a simple
pipeline (Applied -> interview stages -> Offer/Rejected), independently of
whether the job exists in ApplAI's own catalog - most jobs the browser
extension sees are arbitrary external postings, not catalog listings.
"""
import json
import os
import uuid
from datetime import datetime, timezone
from urllib.parse import quote, unquote, urlparse

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from dotenv import load_dotenv

load_dotenv('.env')
TABLE_NAME = os.getenv('APPLICATIONS_TABLE_NAME')

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(TABLE_NAME)

VALID_STATUSES = {
    'Applied', '1st Stage', '2nd Stage', '3rd Stage',
    'Offer', 'Offer Declined', 'Rejected',
}


def get_user_id(event):
    return event['requestContext']['authorizer']['jwt']['claims']['sub']


def normalize_url(raw_url):
    try:
        parsed = urlparse(raw_url)
        host = (parsed.hostname or '').lower()
        path = quote(unquote(parsed.path), safe='/%').rstrip('/')
        return f'{host}{path}'
    except Exception:
        return raw_url.strip().lower()


def list_applications(user_id):
    response = table.query(KeyConditionExpression=Key('user_id').eq(user_id))
    return response.get('Items', [])


def handler(event, context):
    user_id = get_user_id(event)
    method = event['requestContext']['http']['method']
    path_params = event.get('pathParameters') or {}
    application_id = path_params.get('application_id')

    if method == 'GET':
        try:
            items = list_applications(user_id)
        except ClientError as e:
            print(f'DynamoDB query failed: {e}')
            return {'statusCode': 502, 'body': json.dumps({'error': 'applications service failed'})}
        return {'statusCode': 200, 'body': json.dumps({'applications': items})}

    if method == 'POST':
        body = json.loads(event.get('body') or '{}')
        title = body.get('title')
        url = body.get('url')
        if not title or not url:
            return {'statusCode': 400, 'body': json.dumps({'error': 'title and url are required'})}

        status = body.get('status', 'Applied')
        if status not in VALID_STATUSES:
            return {'statusCode': 400, 'body': json.dumps({'error': f'status must be one of {sorted(VALID_STATUSES)}'})}

        url_normalized = normalize_url(url)
        try:
            existing_items = list_applications(user_id)
        except ClientError as e:
            print(f'DynamoDB query failed: {e}')
            return {'statusCode': 502, 'body': json.dumps({'error': 'applications service failed'})}
        for existing in existing_items:
            if existing.get('url_normalized') == url_normalized:
                return {'statusCode': 200, 'body': json.dumps(existing)}

        now = datetime.now(timezone.utc).isoformat()
        item = {
            'user_id': user_id,
            'application_id': str(uuid.uuid4()),
            'title': title,
            'company': body.get('company') or '',
            'url': url,
            'url_normalized': url_normalized,
            'job_id': body.get('job_id'),
            'resume_id': body.get('resume_id'),
            'status': status,
            'applied_at': now,
            'updated_at': now,
        }
        try:
            table.put_item(Item=item)
        except ClientError as e:
            print(f'DynamoDB put_item failed: {e}')
            return {'statusCode': 502, 'body': json.dumps({'error': 'applications service failed'})}
        return {'statusCode': 200, 'body': json.dumps(item)}

    if method == 'PATCH':
        if not application_id:
            return {'statusCode': 400, 'body': json.dumps({'error': 'application_id is required'})}
        body = json.loads(event.get('body') or '{}')
        status = body.get('status')
        if status not in VALID_STATUSES:
            return {'statusCode': 400, 'body': json.dumps({'error': f'status must be one of {sorted(VALID_STATUSES)}'})}

        try:
            response = table.update_item(
                Key={'user_id': user_id, 'application_id': application_id},
                UpdateExpression='SET #s = :status, updated_at = :updated_at',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={
                    ':status': status,
                    ':updated_at': datetime.now(timezone.utc).isoformat(),
                },
                ConditionExpression='attribute_exists(application_id)',
                ReturnValues='ALL_NEW',
            )
        except ClientError as e:
            if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                return {'statusCode': 404, 'body': json.dumps({'error': 'application not found'})}
            print(f'DynamoDB update_item failed: {e}')
            return {'statusCode': 502, 'body': json.dumps({'error': 'applications service failed'})}
        return {'statusCode': 200, 'body': json.dumps(response['Attributes'])}

    if method == 'DELETE':
        if not application_id:
            return {'statusCode': 400, 'body': json.dumps({'error': 'application_id is required'})}
        try:
            table.delete_item(
                Key={'user_id': user_id, 'application_id': application_id},
                ConditionExpression='attribute_exists(application_id)',
            )
        except ClientError as e:
            if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                return {'statusCode': 404, 'body': json.dumps({'error': 'application not found'})}
            print(f'DynamoDB delete_item failed: {e}')
            return {'statusCode': 502, 'body': json.dumps({'error': 'applications service failed'})}
        return {'statusCode': 200, 'body': json.dumps({'deleted': application_id})}

    return {'statusCode': 405, 'body': json.dumps({'error': 'method not allowed'})}

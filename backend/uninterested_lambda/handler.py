"""Triggered by API Gateway, behind a Cognito JWT authorizer. Lets a
logged-in user mark a catalog job as "uninterested" so query_lambda can
exclude it from that user's future search results.
"""
import json
import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv

load_dotenv('.env')
TABLE_NAME = os.getenv('UNINTERESTED_TABLE_NAME')

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(TABLE_NAME)


def get_user_id(event):
    return event['requestContext']['authorizer']['jwt']['claims']['sub']


def handler(event, context):
    user_id = get_user_id(event)
    method = event['requestContext']['http']['method']
    path_params = event.get('pathParameters') or {}
    job_id = path_params.get('job_id')

    if method == 'POST':
        body = json.loads(event.get('body') or '{}')
        job_id = body.get('job_id')
        if not job_id:
            return {'statusCode': 400, 'body': json.dumps({'error': 'job_id is required'})}
        try:
            table.put_item(Item={
                'user_id': user_id,
                'job_id': job_id,
                'marked_at': datetime.now(timezone.utc).isoformat(),
            })
        except ClientError as e:
            print(f'DynamoDB put_item failed: {e}')
            return {'statusCode': 502, 'body': json.dumps({'error': 'uninterested service failed'})}
        return {'statusCode': 200, 'body': json.dumps({'job_id': job_id})}

    if method == 'DELETE':
        if not job_id:
            return {'statusCode': 400, 'body': json.dumps({'error': 'job_id is required'})}
        try:
            table.delete_item(Key={'user_id': user_id, 'job_id': job_id})
        except ClientError as e:
            print(f'DynamoDB delete_item failed: {e}')
            return {'statusCode': 502, 'body': json.dumps({'error': 'uninterested service failed'})}
        return {'statusCode': 200, 'body': json.dumps({'deleted': job_id})}

    return {'statusCode': 405, 'body': json.dumps({'error': 'method not allowed'})}

"""Triggered by API Gateway, behind a Cognito JWT authorizer. Reads or writes
the logged-in user's saved preferences (filters, last resume/skills text) in
DynamoDB, keyed by the Cognito user ID from the validated token.
"""
import json
import os

import boto3

TABLE_NAME = os.getenv('SETTINGS_TABLE_NAME')

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(TABLE_NAME)


def get_user_id(event):
    return event['requestContext']['authorizer']['jwt']['claims']['sub']


def handler(event, context):
    user_id = get_user_id(event)
    method = event['requestContext']['http']['method']

    if method == 'GET':
        response = table.get_item(Key={'user_id': user_id})
        item = response.get('Item', {})
        return {
            'statusCode': 200,
            'body': json.dumps({
                'skills_text': item.get('skills_text', ''),
                'filters': item.get('filters', {}),
            }),
        }

    if method == 'PUT':
        body = json.loads(event.get('body') or '{}')
        table.put_item(Item={
            'user_id': user_id,
            'skills_text': body.get('skills_text', ''),
            'filters': body.get('filters', {}),
        })
        return {'statusCode': 200, 'body': json.dumps({'status': 'saved'})}

    return {'statusCode': 405, 'body': json.dumps({'error': 'method not allowed'})}

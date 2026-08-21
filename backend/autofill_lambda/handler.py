"""Triggered by API Gateway, behind a Cognito JWT authorizer. Takes the
field descriptors the extension's local synonym matcher couldn't resolve,
plus page context, and asks Claude to resolve what it can from the user's
saved profile_info, skills_text, and active resumes' extracted text -
this is how "Company Name" or "Position" get filled even though they only
ever exist as unstructured text in a resume, never in profile_info.

Fields Claude can't confidently resolve are simply omitted from the
response. No Question Bank yet - that's a later increment; for now an
unresolved field just stays blank, same as the local-only matcher's
existing behavior.
"""
import json
import os

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv

load_dotenv('.env')
TABLE_NAME = os.getenv('SETTINGS_TABLE_NAME')
CLAUDE_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
MAX_FIELDS = 60

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(TABLE_NAME)
bedrock_runtime = boto3.client('bedrock-runtime')


def get_user_id(event):
    return event['requestContext']['authorizer']['jwt']['claims']['sub']


def build_profile_text(item):
    active_ids = set(item.get('active_resume_ids', []))
    resume_texts = [r['text'] for r in item.get('resumes', []) if r['id'] in active_ids]
    return '\n'.join(t for t in [item.get('skills_text', ''), *resume_texts] if t).strip()


def build_prompt(fields, profile_info, profile_text, page_title):
    fields_json = json.dumps(fields)
    profile_info_json = json.dumps(profile_info)
    return f"""You are helping fill out a job application form titled "{page_title}".

Structured profile:
{profile_info_json}

Resume / skills text:
{profile_text}

Unmatched form fields (each has a field_id, label, name, id, placeholder,
type, and required - a boolean indicating whether the form marks the
field as required). A field with type "select" is a dropdown and also
has an "options" list of {{"value": "...", "text": "..."}} pairs - it can
only be set to one of those exact "value" strings, never free text:
{fields_json}

For each field, decide if the structured profile or resume/skills text
above contains a clear, confident answer. Fields marked required: true
matter more - make an extra effort to find a defensible answer for them
from the profile or resume, but still never guess wildly on any field.
For a "select" field, return the "value" of whichever option best matches
(e.g. a state option list may use abbreviations or full names, or a
school-type/degree-type list may use different wording than the resume -
match on meaning) - never return text that isn't one of the listed values,
and omit the field entirely if none of its options are a reasonable match.
Respond with ONLY a JSON object in this exact shape, no other text before
or after it:
{{"fills": [{{"field_id": "...", "value": "..."}}]}}
Only include a field in "fills" if you are confident about its value.
Omit any field you cannot confidently answer - do not guess."""


def handler(event, context):
    user_id = get_user_id(event)
    body = json.loads(event.get('body') or '{}')
    fields = body.get('fields') or []
    page_title = body.get('page_title', '')

    if not fields:
        return {'statusCode': 200, 'body': json.dumps({'fills': []})}

    fields = fields[:MAX_FIELDS]

    try:
        response = table.get_item(Key={'user_id': user_id})
    except ClientError as e:
        print(f'DynamoDB get_item failed: {e}')
        return {'statusCode': 502, 'body': json.dumps({'error': 'autofill service failed'})}

    item = response.get('Item', {})
    profile_info = item.get('profile_info', {})
    profile_text = build_profile_text(item)

    if not profile_info and not profile_text:
        return {'statusCode': 200, 'body': json.dumps({'fills': []})}

    prompt = build_prompt(fields, profile_info, profile_text[:20000], page_title)

    try:
        response = bedrock_runtime.invoke_model(
            modelId=CLAUDE_MODEL_ID,
            body=json.dumps({
                'anthropic_version': 'bedrock-2023-05-31',
                'max_tokens': 1000,
                'messages': [{'role': 'user', 'content': prompt}],
            }),
        )
        result = json.loads(response['body'].read())
        claude_text = result['content'][0]['text'].strip()
        if claude_text.startswith('```'):
            claude_text = claude_text.strip('`').strip()
            if claude_text.startswith('json'):
                claude_text = claude_text[4:].strip()
        parsed = json.loads(claude_text)
        raw_fills = parsed['fills']
    except Exception as e:
        print(f'autofill failed: {e}')
        return {'statusCode': 502, 'body': json.dumps({'error': 'autofill failed'})}

    fields_by_id = {f['field_id']: f for f in fields}
    fills = []
    for f in raw_fills:
        if not isinstance(f, dict):
            continue
        field = fields_by_id.get(f.get('field_id'))
        value = f.get('value')
        if field is None or not isinstance(value, str) or not value.strip():
            continue
        if field.get('type') == 'select':
            option_values = {opt.get('value') for opt in field.get('options', [])}
            if value not in option_values:
                continue
        fills.append(f)

    return {'statusCode': 200, 'body': json.dumps({'fills': fills})}

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
MAX_SECTION_COUNT = 6

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(TABLE_NAME)
bedrock_runtime = boto3.client('bedrock-runtime')


def get_user_id(event):
    return event['requestContext']['authorizer']['jwt']['claims']['sub']


def build_profile_text(item):
    active_ids = set(item.get('active_resume_ids', []))
    resume_texts = [r['text'] for r in item.get('resumes', []) if r['id'] in active_ids]
    return '\n'.join(t for t in [item.get('skills_text', ''), *resume_texts] if t).strip()


FILLS_TOOL_SCHEMA = {
    'type': 'object',
    'properties': {
        'fills': {
            'type': 'array',
            'items': {
                'type': 'object',
                'properties': {
                    'field_id': {'type': 'string'},
                    'value': {'type': 'string'},
                },
                'required': ['field_id', 'value'],
            },
        },
    },
    'required': ['fills'],
}

COUNTS_TOOL_SCHEMA = {
    'type': 'object',
    'properties': {
        'education': {'type': 'integer'},
        'work_history': {'type': 'integer'},
    },
    'required': ['education', 'work_history'],
}


def invoke_claude_tool(prompt, tool_name, tool_schema, max_tokens):
    # Asking Claude to hand-write a JSON blob as plain text and parsing it
    # ourselves kept breaking in new ways in production (a literal newline
    # in a multi-line answer, an unescaped quote in resume text) - each fix
    # only covered the one malformation already seen. Tool use sidesteps
    # the whole category: Bedrock generates the tool's "input" under
    # constrained decoding against tool_schema, so it comes back as an
    # already-valid, already-parsed object - there is no free-text JSON to
    # parse here at all.
    response = bedrock_runtime.invoke_model(
        modelId=CLAUDE_MODEL_ID,
        body=json.dumps({
            'anthropic_version': 'bedrock-2023-05-31',
            'max_tokens': max_tokens,
            'tools': [{
                'name': tool_name,
                'description': f'Report the {tool_name.replace("_", " ")} result.',
                'input_schema': tool_schema,
            }],
            'tool_choice': {'type': 'tool', 'name': tool_name},
            'messages': [{'role': 'user', 'content': prompt}],
        }),
    )
    result = json.loads(response['body'].read())
    tool_use = next(block for block in result['content'] if block.get('type') == 'tool_use')
    return tool_use['input']


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
field as required). A field with type "select" or "combobox" is a
dropdown and also has an "options" list of {{"value": "...", "text": "..."}}
pairs - it can only be set to one of those exact "value" strings, never
free text:
{fields_json}

For each field, decide if the structured profile or resume/skills text
above contains a clear, confident answer. Fields marked required: true
matter more - make an extra effort to find a defensible answer for them
from the profile or resume, but still never guess wildly on any field.
For a "select" or "combobox" field, return the "value" of whichever
option best matches (e.g. a state option list may use abbreviations or
full names, or a school-type/degree-type list may use different wording
than the resume - match on meaning) - never return text that isn't one
of the listed values, and omit the field entirely if none of its options
are a reasonable match.
Only include a field in "fills" if you are confident about its value.
Omit any field you cannot confidently answer - do not guess."""


def build_counts_prompt(profile_text):
    return f"""Resume / skills text:
{profile_text}

Count how many separate education entries (distinct degrees/schools) and
how many separate work history entries (distinct jobs/employers) this
text lists. Use 0 for a count if that section isn't present at all.
Count only entries that are actually there - do not guess or round up."""


def handle_counts(user_id):
    try:
        response = table.get_item(Key={'user_id': user_id})
    except ClientError as e:
        print(f'DynamoDB get_item failed: {e}')
        return {'statusCode': 502, 'body': json.dumps({'error': 'autofill service failed'})}

    item = response.get('Item', {})
    profile_text = build_profile_text(item)

    if not profile_text:
        return {'statusCode': 200, 'body': json.dumps({'counts': {'education': 0, 'work_history': 0}})}

    prompt = build_counts_prompt(profile_text[:20000])

    try:
        parsed = invoke_claude_tool(prompt, 'report_counts', COUNTS_TOOL_SCHEMA, max_tokens=100)
        education = max(0, min(int(parsed.get('education', 0)), MAX_SECTION_COUNT))
        work_history = max(0, min(int(parsed.get('work_history', 0)), MAX_SECTION_COUNT))
    except Exception as e:
        print(f'counts failed: {e}')
        return {'statusCode': 502, 'body': json.dumps({'error': 'counts failed'})}

    return {'statusCode': 200, 'body': json.dumps({'counts': {'education': education, 'work_history': work_history}})}


def handler(event, context):
    user_id = get_user_id(event)
    body = json.loads(event.get('body') or '{}')

    if body.get('mode') == 'counts':
        return handle_counts(user_id)

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
        # A request can carry up to MAX_FIELDS (60) fields, several of
        # which may be textarea answers (e.g. "Responsibilities") several
        # sentences long - 1000 was tight enough that a big batch could
        # get cut off mid-generation before the tool call's "fills" key
        # was ever written, which surfaced as a bare KeyError('fills').
        parsed = invoke_claude_tool(prompt, 'report_fills', FILLS_TOOL_SCHEMA, max_tokens=4000)
        raw_fills = parsed.get('fills', [])
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
        if field.get('type') in ('select', 'combobox'):
            option_values = {opt.get('value') for opt in field.get('options', [])}
            if value not in option_values:
                continue
        fills.append(f)

    return {'statusCode': 200, 'body': json.dumps({'fills': fills})}

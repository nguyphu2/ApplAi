import base64
import json

import pytest
from botocore.exceptions import ClientError


def make_event(method, user_id='user-123', body=None):
    event = {
        'requestContext': {
            'http': {'method': method},
            'authorizer': {'jwt': {'claims': {'sub': user_id}}},
        },
    }
    if body is not None:
        event['body'] = json.dumps(body)
    return event


def test_get_returns_empty_profile_info_by_default(handler_module):
    response = handler_module.handler(make_event('GET'), None)

    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    assert body['profile_info'] == {}


def test_put_saves_and_returns_profile_info(handler_module):
    profile_info = {
        'full_name': 'Ada Lovelace',
        'email': 'ada@example.com',
        'phone': '555-0100',
        'address': '123 Analytical Engine Way',
        'linkedin_url': 'https://linkedin.com/in/ada',
        'portfolio_url': 'https://ada.dev',
        'work_authorization': 'US Citizen',
    }

    put_response = handler_module.handler(
        make_event('PUT', body={'profile_info': profile_info}), None
    )
    assert put_response['statusCode'] == 200
    assert json.loads(put_response['body'])['profile_info'] == profile_info

    get_response = handler_module.handler(make_event('GET'), None)
    assert json.loads(get_response['body'])['profile_info'] == profile_info


def test_put_profile_info_does_not_clobber_skills_text(handler_module):
    handler_module.handler(
        make_event('PUT', body={'skills_text': 'Python, AWS'}), None
    )

    handler_module.handler(
        make_event('PUT', body={'profile_info': {'full_name': 'Grace Hopper'}}), None
    )

    get_response = handler_module.handler(make_event('GET'), None)
    body = json.loads(get_response['body'])
    assert body['skills_text'] == 'Python, AWS'
    assert body['profile_info'] == {'full_name': 'Grace Hopper'}


def test_profile_info_is_scoped_per_user(handler_module):
    handler_module.handler(
        make_event('PUT', user_id='user-a', body={'profile_info': {'full_name': 'User A'}}),
        None,
    )

    get_response = handler_module.handler(make_event('GET', user_id='user-b'), None)
    assert json.loads(get_response['body'])['profile_info'] == {}


def test_add_resume_uploads_pdf_to_s3_and_returns_a_working_url(handler_module, monkeypatch):
    monkeypatch.setattr(handler_module, 'extract_text_from_pdf', lambda pdf_bytes: 'extracted text')
    pdf_base64 = base64.b64encode(b'%PDF-1.4 fake pdf bytes').decode('utf-8')

    put_response = handler_module.handler(
        make_event('PUT', body={'add_resume': {'filename': 'resume.pdf', 'resume_pdf_base64': pdf_base64}}),
        None,
    )

    assert put_response['statusCode'] == 200
    body = json.loads(put_response['body'])
    assert len(body['resumes']) == 1
    resume = body['resumes'][0]
    assert resume['filename'] == 'resume.pdf'
    assert resume['text'] == 'extracted text'
    assert resume['pdf_url'].startswith('https://')

    stored_object = handler_module.s3_client.get_object(
        Bucket=handler_module.BUCKET_NAME,
        Key=handler_module.resume_pdf_key('user-123', resume['id']),
    )
    assert stored_object['Body'].read() == b'%PDF-1.4 fake pdf bytes'


def test_pdf_url_is_not_persisted_to_dynamodb(handler_module, monkeypatch):
    monkeypatch.setattr(handler_module, 'extract_text_from_pdf', lambda pdf_bytes: 'extracted text')
    pdf_base64 = base64.b64encode(b'fake pdf').decode('utf-8')

    handler_module.handler(
        make_event('PUT', body={'add_resume': {'filename': 'resume.pdf', 'resume_pdf_base64': pdf_base64}}),
        None,
    )

    raw_item = handler_module.table.get_item(Key={'user_id': 'user-123'})['Item']
    assert 'pdf_url' not in raw_item['resumes'][0]


def test_remove_resume_deletes_the_pdf_from_s3(handler_module, monkeypatch):
    monkeypatch.setattr(handler_module, 'extract_text_from_pdf', lambda pdf_bytes: 'extracted text')
    pdf_base64 = base64.b64encode(b'fake pdf').decode('utf-8')

    put_response = handler_module.handler(
        make_event('PUT', body={'add_resume': {'filename': 'resume.pdf', 'resume_pdf_base64': pdf_base64}}),
        None,
    )
    resume_id = json.loads(put_response['body'])['resumes'][0]['id']

    handler_module.handler(make_event('PUT', body={'remove_resume_id': resume_id}), None)

    with pytest.raises(ClientError):
        handler_module.s3_client.get_object(
            Bucket=handler_module.BUCKET_NAME,
            Key=handler_module.resume_pdf_key('user-123', resume_id),
        )

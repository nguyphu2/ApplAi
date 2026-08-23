import base64
import io
import json
from urllib.parse import parse_qs, urlparse

import pytest
from botocore.exceptions import ClientError
from docx import Document


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


def make_test_docx(paragraphs):
    document = Document()
    for text in paragraphs:
        document.add_paragraph(text)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


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


def test_add_resume_uploads_docx_to_s3_and_returns_a_working_url(handler_module, monkeypatch):
    monkeypatch.setattr(handler_module, 'extract_docx_text', lambda docx_bytes: 'extracted text')
    docx_base64 = base64.b64encode(b'fake docx bytes').decode('utf-8')

    put_response = handler_module.handler(
        make_event('PUT', body={'add_resume': {'filename': 'resume.docx', 'resume_docx_base64': docx_base64}}),
        None,
    )

    assert put_response['statusCode'] == 200
    body = json.loads(put_response['body'])
    assert len(body['resumes']) == 1
    resume = body['resumes'][0]
    assert resume['filename'] == 'resume.docx'
    assert resume['text'] == 'extracted text'
    assert resume['file_type'] == 'docx'
    assert resume['file_url'].startswith('https://')

    stored_object = handler_module.s3_client.get_object(
        Bucket=handler_module.BUCKET_NAME,
        Key=handler_module.resume_file_key('user-123', resume['id'], 'docx'),
    )
    assert stored_object['Body'].read() == b'fake docx bytes'


def test_resume_url_sets_download_filename_from_stored_filename(handler_module, monkeypatch):
    monkeypatch.setattr(handler_module, 'extract_docx_text', lambda docx_bytes: 'extracted text')
    docx_base64 = base64.b64encode(b'fake docx bytes').decode('utf-8')

    put_response = handler_module.handler(
        make_event('PUT', body={'add_resume': {'filename': 'AdaLovelace_SoftwareEngineer.docx', 'resume_docx_base64': docx_base64}}),
        None,
    )

    resume = json.loads(put_response['body'])['resumes'][0]
    query = parse_qs(urlparse(resume['file_url']).query)
    assert query['response-content-disposition'][0] == 'attachment; filename="AdaLovelace_SoftwareEngineer.docx"'


def test_file_url_is_not_persisted_to_dynamodb(handler_module, monkeypatch):
    monkeypatch.setattr(handler_module, 'extract_docx_text', lambda docx_bytes: 'extracted text')
    docx_base64 = base64.b64encode(b'fake docx').decode('utf-8')

    handler_module.handler(
        make_event('PUT', body={'add_resume': {'filename': 'resume.docx', 'resume_docx_base64': docx_base64}}),
        None,
    )

    raw_item = handler_module.table.get_item(Key={'user_id': 'user-123'})['Item']
    assert 'file_url' not in raw_item['resumes'][0]


def test_remove_resume_deletes_the_file_from_s3(handler_module, monkeypatch):
    monkeypatch.setattr(handler_module, 'extract_docx_text', lambda docx_bytes: 'extracted text')
    docx_base64 = base64.b64encode(b'fake docx').decode('utf-8')

    put_response = handler_module.handler(
        make_event('PUT', body={'add_resume': {'filename': 'resume.docx', 'resume_docx_base64': docx_base64}}),
        None,
    )
    resume_id = json.loads(put_response['body'])['resumes'][0]['id']

    handler_module.handler(make_event('PUT', body={'remove_resume_id': resume_id}), None)

    with pytest.raises(ClientError):
        handler_module.s3_client.get_object(
            Bucket=handler_module.BUCKET_NAME,
            Key=handler_module.resume_file_key('user-123', resume_id, 'docx'),
        )


def test_extract_docx_text_reads_real_paragraphs(handler_module):
    docx_bytes = make_test_docx(['Ada Lovelace', 'Software Engineer Intern at Acme Corp', '', 'Built REST APIs'])

    text = handler_module.extract_docx_text(docx_bytes)

    assert text == 'Ada Lovelace\nSoftware Engineer Intern at Acme Corp\nBuilt REST APIs'


def test_extract_docx_text_raises_on_table_based_or_near_empty_docx(handler_module):
    docx_bytes = make_test_docx(['Ada Lovelace'])

    with pytest.raises(ValueError):
        handler_module.extract_docx_text(docx_bytes)


def test_add_resume_with_near_empty_docx_returns_422(handler_module):
    docx_bytes = make_test_docx(['Ada Lovelace'])
    docx_base64 = base64.b64encode(docx_bytes).decode('utf-8')

    put_response = handler_module.handler(
        make_event('PUT', body={'add_resume': {'filename': 'resume.docx', 'resume_docx_base64': docx_base64}}),
        None,
    )

    assert put_response['statusCode'] == 422
    assert json.loads(put_response['body'])['error'] == 'could not read DOCX'

import json


def make_event(method, user_id='user-123', body=None, application_id=None):
    event = {
        'requestContext': {
            'http': {'method': method},
            'authorizer': {'jwt': {'claims': {'sub': user_id}}},
        },
    }
    if body is not None:
        event['body'] = json.dumps(body)
    if application_id is not None:
        event['pathParameters'] = {'application_id': application_id}
    return event


def test_post_creates_application_with_defaults(handler_module):
    response = handler_module.handler(make_event('POST', body={
        'title': 'Machine Learning Engineer Intern',
        'company': 'SpreeAI',
        'url': 'https://ats.rippling.com/spreeai/jobs/aa087086-dd4b-42be-a499-051546655e97?utm_source=adzuna',
    }), None)

    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    assert body['status'] == 'Applied'
    assert body['url_normalized'] == 'ats.rippling.com/spreeai/jobs/aa087086-dd4b-42be-a499-051546655e97'
    assert body['job_id'] is None
    assert body['resume_id'] is None
    assert 'application_id' in body
    assert body['applied_at'] == body['updated_at']


def test_post_rejects_missing_title_or_url(handler_module):
    response = handler_module.handler(make_event('POST', body={'company': 'SpreeAI'}), None)
    assert response['statusCode'] == 400


def test_post_rejects_invalid_status(handler_module):
    response = handler_module.handler(make_event('POST', body={
        'title': 'Role', 'url': 'https://example.com/job', 'status': 'Ghosted',
    }), None)
    assert response['statusCode'] == 400


def test_get_lists_only_the_caller_users_applications(handler_module):
    handler_module.handler(make_event('POST', user_id='user-a', body={
        'title': 'Role A', 'url': 'https://example.com/a',
    }), None)
    handler_module.handler(make_event('POST', user_id='user-b', body={
        'title': 'Role B', 'url': 'https://example.com/b',
    }), None)

    response = handler_module.handler(make_event('GET', user_id='user-a'), None)

    assert response['statusCode'] == 200
    applications = json.loads(response['body'])['applications']
    assert len(applications) == 1
    assert applications[0]['title'] == 'Role A'


def test_patch_updates_status_and_updated_at(handler_module):
    create_response = handler_module.handler(make_event('POST', body={
        'title': 'Role', 'url': 'https://example.com/job',
    }), None)
    application_id = json.loads(create_response['body'])['application_id']
    original_updated_at = json.loads(create_response['body'])['updated_at']

    response = handler_module.handler(make_event(
        'PATCH', body={'status': '1st Stage'}, application_id=application_id,
    ), None)

    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    assert body['status'] == '1st Stage'
    assert body['updated_at'] >= original_updated_at


def test_patch_rejects_invalid_status(handler_module):
    create_response = handler_module.handler(make_event('POST', body={
        'title': 'Role', 'url': 'https://example.com/job',
    }), None)
    application_id = json.loads(create_response['body'])['application_id']

    response = handler_module.handler(make_event(
        'PATCH', body={'status': 'Ghosted'}, application_id=application_id,
    ), None)
    assert response['statusCode'] == 400


def test_patch_returns_404_for_missing_application(handler_module):
    response = handler_module.handler(make_event(
        'PATCH', body={'status': 'Offer'}, application_id='does-not-exist',
    ), None)
    assert response['statusCode'] == 404


def test_patch_cannot_update_another_users_application(handler_module):
    create_response = handler_module.handler(make_event('POST', user_id='user-a', body={
        'title': 'Role', 'url': 'https://example.com/job',
    }), None)
    application_id = json.loads(create_response['body'])['application_id']

    response = handler_module.handler(make_event(
        'PATCH', user_id='user-b', body={'status': 'Offer'}, application_id=application_id,
    ), None)
    assert response['statusCode'] == 404


def test_delete_removes_application(handler_module):
    create_response = handler_module.handler(make_event('POST', body={
        'title': 'Role', 'url': 'https://example.com/job',
    }), None)
    application_id = json.loads(create_response['body'])['application_id']

    delete_response = handler_module.handler(make_event('DELETE', application_id=application_id), None)
    assert delete_response['statusCode'] == 200

    get_response = handler_module.handler(make_event('GET'), None)
    assert json.loads(get_response['body'])['applications'] == []


def test_delete_returns_404_for_missing_application(handler_module):
    response = handler_module.handler(make_event('DELETE', application_id='does-not-exist'), None)
    assert response['statusCode'] == 404


def test_post_stores_job_id_and_resume_id_when_provided(handler_module):
    response = handler_module.handler(make_event('POST', body={
        'title': 'Role', 'url': 'https://example.com/job',
        'job_id': 'job-42', 'resume_id': 'resume-7',
    }), None)

    body = json.loads(response['body'])
    assert body['job_id'] == 'job-42'
    assert body['resume_id'] == 'resume-7'

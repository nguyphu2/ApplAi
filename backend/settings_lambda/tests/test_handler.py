import json


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

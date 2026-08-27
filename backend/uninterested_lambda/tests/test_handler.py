import json


def make_event(method, user_id='user-123', body=None, job_id=None):
    event = {
        'requestContext': {
            'http': {'method': method},
            'authorizer': {'jwt': {'claims': {'sub': user_id}}},
        },
    }
    if body is not None:
        event['body'] = json.dumps(body)
    if job_id is not None:
        event['pathParameters'] = {'job_id': job_id}
    return event


def test_post_marks_job_uninterested(handler_module):
    response = handler_module.handler(make_event('POST', body={'job_id': 'job-1'}), None)
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    assert body['job_id'] == 'job-1'

    item = handler_module.table.get_item(Key={'user_id': 'user-123', 'job_id': 'job-1'})['Item']
    assert item['user_id'] == 'user-123'
    assert item['job_id'] == 'job-1'
    assert 'marked_at' in item


def test_post_rejects_missing_job_id(handler_module):
    response = handler_module.handler(make_event('POST', body={}), None)
    assert response['statusCode'] == 400


def test_post_scoped_per_user(handler_module):
    handler_module.handler(make_event('POST', user_id='user-a', body={'job_id': 'job-1'}), None)
    item = handler_module.table.get_item(Key={'user_id': 'user-b', 'job_id': 'job-1'})
    assert 'Item' not in item


def test_delete_removes_uninterested_mark(handler_module):
    handler_module.handler(make_event('POST', body={'job_id': 'job-1'}), None)
    response = handler_module.handler(make_event('DELETE', job_id='job-1'), None)
    assert response['statusCode'] == 200

    item = handler_module.table.get_item(Key={'user_id': 'user-123', 'job_id': 'job-1'})
    assert 'Item' not in item


def test_delete_is_idempotent_for_missing_job(handler_module):
    response = handler_module.handler(make_event('DELETE', job_id='does-not-exist'), None)
    assert response['statusCode'] == 200


def test_delete_requires_job_id(handler_module):
    response = handler_module.handler(make_event('DELETE'), None)
    assert response['statusCode'] == 400

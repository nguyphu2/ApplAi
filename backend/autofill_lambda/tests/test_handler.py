import json
from unittest.mock import MagicMock


def make_event(user_id='user-123', body=None):
    event = {
        'requestContext': {
            'authorizer': {'jwt': {'claims': {'sub': user_id}}},
        },
    }
    if body is not None:
        event['body'] = json.dumps(body)
    return event


def make_bedrock_response(fills):
    payload = json.dumps({'fills': fills})
    return {
        'body': MagicMock(read=lambda: json.dumps({
            'content': [{'text': payload}],
        }).encode('utf-8'))
    }


def test_returns_empty_fills_when_no_fields_given(handler_module):
    response = handler_module.handler(make_event(body={'fields': [], 'page_title': ''}), None)

    assert response['statusCode'] == 200
    assert json.loads(response['body']) == {'fills': []}


def test_truncates_to_max_fields_instead_of_rejecting(handler_module, monkeypatch):
    handler_module.table.put_item(Item={'user_id': 'user-123', 'profile_info': {'full_name': 'Ada Lovelace'}})
    invoke_model = MagicMock(return_value=make_bedrock_response([]))
    monkeypatch.setattr(handler_module, 'bedrock_runtime', MagicMock(invoke_model=invoke_model))

    too_many = [
        {'field_id': f'f{i}', 'label': '', 'name': '', 'id': '', 'placeholder': '', 'type': 'text'}
        for i in range(handler_module.MAX_FIELDS + 10)
    ]
    response = handler_module.handler(make_event(body={'fields': too_many, 'page_title': ''}), None)

    assert response['statusCode'] == 200
    sent_prompt = json.loads(invoke_model.call_args.kwargs['body'])['messages'][0]['content']
    fields_line = next(line for line in sent_prompt.split('\n') if line.startswith('['))
    sent_fields = json.loads(fields_line)
    assert len(sent_fields) == handler_module.MAX_FIELDS
    assert sent_fields[0]['field_id'] == 'f0'
    assert sent_fields[-1]['field_id'] == f'f{handler_module.MAX_FIELDS - 1}'


def test_returns_empty_fills_when_user_has_no_profile_data(handler_module, monkeypatch):
    invoke_model = MagicMock()
    monkeypatch.setattr(handler_module, 'bedrock_runtime', MagicMock(invoke_model=invoke_model))

    fields = [{'field_id': 'f0', 'label': 'Company Name', 'name': '', 'id': '', 'placeholder': '', 'type': 'text'}]
    response = handler_module.handler(make_event(body={'fields': fields, 'page_title': 'Apply'}), None)

    assert response['statusCode'] == 200
    assert json.loads(response['body']) == {'fills': []}
    invoke_model.assert_not_called()


def test_resolves_fields_from_resume_text_via_bedrock(handler_module, monkeypatch):
    handler_module.table.put_item(Item={
        'user_id': 'user-123',
        'profile_info': {'full_name': 'Ada Lovelace'},
        'skills_text': '',
        'resumes': [{'id': 'r1', 'filename': 'resume.pdf', 'text': 'Worked at Acme Corp as a Software Engineer Intern.', 'uploaded_at': '2026-01-01T00:00:00Z'}],
        'active_resume_ids': ['r1'],
    })

    invoke_model = MagicMock(return_value=make_bedrock_response([
        {'field_id': 'f0', 'value': 'Acme Corp'},
        {'field_id': 'f1', 'value': 'Software Engineer Intern'},
    ]))
    monkeypatch.setattr(handler_module, 'bedrock_runtime', MagicMock(invoke_model=invoke_model))

    fields = [
        {'field_id': 'f0', 'label': 'Company Name', 'name': '', 'id': '', 'placeholder': '', 'type': 'text'},
        {'field_id': 'f1', 'label': 'Position', 'name': '', 'id': '', 'placeholder': '', 'type': 'text'},
    ]
    response = handler_module.handler(make_event(body={'fields': fields, 'page_title': 'Apply to Acme'}), None)

    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    assert body == {'fills': [
        {'field_id': 'f0', 'value': 'Acme Corp'},
        {'field_id': 'f1', 'value': 'Software Engineer Intern'},
    ]}
    invoke_model.assert_called_once()
    sent_prompt = json.loads(invoke_model.call_args.kwargs['body'])['messages'][0]['content']
    assert 'Acme Corp' in sent_prompt
    assert 'Company Name' in sent_prompt


def test_select_field_only_accepts_a_value_from_its_own_options(handler_module, monkeypatch):
    handler_module.table.put_item(Item={
        'user_id': 'user-123',
        'profile_info': {'state': 'Oregon'},
    })
    invoke_model = MagicMock(return_value=make_bedrock_response([
        {'field_id': 'f0', 'value': 'OR'},
        {'field_id': 'f0', 'value': 'NOT_A_REAL_OPTION'},
    ]))
    monkeypatch.setattr(handler_module, 'bedrock_runtime', MagicMock(invoke_model=invoke_model))

    fields = [{
        'field_id': 'f0', 'label': 'State', 'name': '', 'id': '', 'placeholder': '',
        'type': 'select', 'required': False,
        'options': [{'value': 'OR', 'text': 'Oregon'}, {'value': 'WA', 'text': 'Washington'}],
    }]
    response = handler_module.handler(make_event(body={'fields': fields, 'page_title': ''}), None)

    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    assert body == {'fills': [{'field_id': 'f0', 'value': 'OR'}]}


def test_returns_502_when_bedrock_call_fails(handler_module, monkeypatch):
    handler_module.table.put_item(Item={
        'user_id': 'user-123',
        'profile_info': {'full_name': 'Ada Lovelace'},
    })
    invoke_model = MagicMock(side_effect=Exception('bedrock unavailable'))
    monkeypatch.setattr(handler_module, 'bedrock_runtime', MagicMock(invoke_model=invoke_model))

    fields = [{'field_id': 'f0', 'label': 'Company Name', 'name': '', 'id': '', 'placeholder': '', 'type': 'text'}]
    response = handler_module.handler(make_event(body={'fields': fields, 'page_title': ''}), None)

    assert response['statusCode'] == 502


def test_only_uses_active_resumes_for_prompt_text(handler_module, monkeypatch):
    handler_module.table.put_item(Item={
        'user_id': 'user-123',
        'profile_info': {},
        'skills_text': '',
        'resumes': [
            {'id': 'r1', 'filename': 'active.pdf', 'text': 'ACTIVE_RESUME_MARKER', 'uploaded_at': '2026-01-01T00:00:00Z'},
            {'id': 'r2', 'filename': 'inactive.pdf', 'text': 'INACTIVE_RESUME_MARKER', 'uploaded_at': '2026-01-01T00:00:00Z'},
        ],
        'active_resume_ids': ['r1'],
    })
    invoke_model = MagicMock(return_value=make_bedrock_response([]))
    monkeypatch.setattr(handler_module, 'bedrock_runtime', MagicMock(invoke_model=invoke_model))

    fields = [{'field_id': 'f0', 'label': 'Company Name', 'name': '', 'id': '', 'placeholder': '', 'type': 'text'}]
    handler_module.handler(make_event(body={'fields': fields, 'page_title': ''}), None)

    sent_prompt = json.loads(invoke_model.call_args.kwargs['body'])['messages'][0]['content']
    assert 'ACTIVE_RESUME_MARKER' in sent_prompt
    assert 'INACTIVE_RESUME_MARKER' not in sent_prompt

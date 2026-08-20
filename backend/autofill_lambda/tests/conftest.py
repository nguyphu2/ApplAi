import os
import sys

import boto3
import pytest
from moto import mock_aws

TABLE_NAME = 'test-settings-table'


@pytest.fixture
def handler_module():
    os.environ['SETTINGS_TABLE_NAME'] = TABLE_NAME
    os.environ['AWS_DEFAULT_REGION'] = 'us-east-1'
    os.environ['AWS_ACCESS_KEY_ID'] = 'testing'
    os.environ['AWS_SECRET_ACCESS_KEY'] = 'testing'

    with mock_aws():
        dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
        dynamodb.create_table(
            TableName=TABLE_NAME,
            KeySchema=[{'AttributeName': 'user_id', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'user_id', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST',
        )

        sys.modules.pop('handler', None)
        import handler as handler_mod

        yield handler_mod

        sys.modules.pop('handler', None)

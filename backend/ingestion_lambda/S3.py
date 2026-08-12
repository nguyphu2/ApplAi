import boto3
import json
import os
from dotenv import load_dotenv


load_dotenv('.env')
s3_bucket = os.getenv('BUCKET_NAME')

s3_client = boto3.client('s3')


SALARY_UNKNOWN_SENTINEL = 10_000_000


def upload(job):
    key = f"jobs/{job['job_id']}.json"

    s3_client.put_object(
        Bucket=s3_bucket,
        Key=key,
        Body=json.dumps(job).encode('utf-8'),
        ContentType='application/json',
    )

    salary_max = job['salary_max'] if job['salary_max'] is not None else SALARY_UNKNOWN_SENTINEL
    metadata = {
        'metadataAttributes': {
            'remote': {
                'value': {'type': 'BOOLEAN', 'booleanValue': job['remote']},
                'includeForEmbedding': False,
            },
            'location': {
                'value': {'type': 'STRING', 'stringValue': job['location'].lower()},
                'includeForEmbedding': False,
            },
            'salary_max': {
                'value': {'type': 'NUMBER', 'numberValue': salary_max},
                'includeForEmbedding': False,
            },
        }
    }

    s3_client.put_object(
        Bucket=s3_bucket,
        Key=f"{key}.metadata.json",
        Body=json.dumps(metadata).encode('utf-8'),
        ContentType='application/json',
    )

    return f"s3://{s3_bucket}/{key}"


"""Triggered by EventBridge Scheduler. Pulls job postings from Adzuna, writes
normalized JSON to S3, then starts a Bedrock Knowledge Base ingestion job so
the new postings get embedded and become searchable.
"""


def handler(event, context):
    # TODO: call Adzuna API, normalize postings, write to S3
    # TODO: call bedrock-agent StartIngestionJob for the Knowledge Base
    raise NotImplementedError

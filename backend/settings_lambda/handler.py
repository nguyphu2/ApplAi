"""Triggered by API Gateway, behind a Cognito authorizer. Reads or writes the
logged-in user's saved preferences (filters, last resume/skills text) in
DynamoDB, keyed by the Cognito user ID from the validated token.
"""


def handler(event, context):
    # TODO: read Cognito user ID from the request context (already validated by API Gateway)
    # TODO: GET -> read the user's row from DynamoDB; PUT -> write it
    raise NotImplementedError

"""Triggered by API Gateway. Takes a resume (PDF, via Textract) and/or pasted
skills plus filters, embeds the profile, queries the Bedrock Knowledge Base
for matching job postings, and generates a match explanation + skill-gap
list per result via Claude. Works for guests (no auth token required).
"""


def handler(event, context):
    # TODO: if a PDF was uploaded, extract text via Textract
    # TODO: embed combined resume/skills text via Bedrock Titan
    # TODO: query the Knowledge Base with metadata filters (location/remote/salary)
    # TODO: for each top match, call Claude for explanation + skill-gap analysis
    raise NotImplementedError

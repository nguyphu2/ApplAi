import boto3

textract_client = boto3.client('textract')


def extract_text_from_pdf(pdf_bytes):
    response = textract_client.detect_document_text(Document={'Bytes': pdf_bytes})
    lines = [block['Text'] for block in response['Blocks'] if block['BlockType'] == 'LINE']
    return '\n'.join(lines)

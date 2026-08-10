# Applai

AI-powered job matcher: semantic matching between a resume/skills profile and real job postings,
with AI-generated match explanations and skill-gap analysis. Built on AWS (Lambda, Bedrock, S3
Vectors, Cognito, DynamoDB, API Gateway, CloudFront).

Status: in development. Design doc lives in `docs/` (kept local, not tracked in this repo).

## Structure

```
backend/
  ingestion_lambda/   # pulls job postings from Adzuna on a schedule, writes to S3
  query_lambda/        # matching flow: embed profile, query Knowledge Base, generate explanations
  settings_lambda/     # save/load a logged-in user's preferences (DynamoDB)
frontend/
  index.html, app.js, style.css   # static site hosted on S3 + CloudFront
```

## Requirements

- Python 3.12+ (Lambda runtime)
- AWS account with Bedrock model access enabled
- Adzuna API credentials (free tier)

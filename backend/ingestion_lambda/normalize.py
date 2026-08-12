from datetime import datetime, timezone


def normalize_job(raw_job):
    location = raw_job.get("location", {}).get("display_name", "")
    description = raw_job.get("description", "")
    remote = "remote" in location.lower() or "remote" in description.lower()

    return {
        "job_id": str(raw_job["id"]),
        "title": raw_job.get("title", ""),
        "company": raw_job.get("company", {}).get("display_name", ""),
        "location": location,
        "description": description,
        "salary_min": raw_job.get("salary_min"),
        "salary_max": raw_job.get("salary_max"),
        "remote": remote,
        "listing_url": raw_job.get("redirect_url", ""),
        "source": "adzuna",
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }

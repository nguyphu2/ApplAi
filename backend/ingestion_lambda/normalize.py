from datetime import datetime, timezone


def normalize_job(raw_job):
    """raw_job is one entry from SimplifyJobs' public listings.json - see
    https://github.com/SimplifyJobs/Summer2027-Internships. Its `url` field
    is the real, direct application page (Greenhouse/Lever/Workday/etc.),
    not a redirect, which is the whole reason this replaced Adzuna.
    """
    locations = raw_job.get("locations") or []
    location = "; ".join(locations)
    remote = any("remote" in loc.lower() for loc in locations)

    date_posted = raw_job.get("date_posted")
    posted_at = (
        datetime.fromtimestamp(date_posted, tz=timezone.utc).isoformat()
        if date_posted
        else datetime.now(timezone.utc).isoformat()
    )

    description = ", ".join(filter(None, [
        raw_job.get("category"),
        raw_job.get("company_name"),
        location,
    ]))

    return {
        "job_id": raw_job["id"],
        "title": raw_job.get("title", ""),
        "company": raw_job.get("company_name", ""),
        "location": location,
        "description": description,
        "salary_min": None,
        "salary_max": None,
        "remote": remote,
        "listing_url": raw_job.get("url", ""),
        "source": "simplify",
        "ingested_at": posted_at,
    }

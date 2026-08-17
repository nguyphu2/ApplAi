SALARY_UNKNOWN_SENTINEL = 10_000_000


def build_metadata_filter(filters):
    conditions = []

    location = filters.get('location')
    if location:
        conditions.append({'stringContains': {'key': 'location', 'value': location.lower()}})

    title = filters.get('title')
    if title:
        conditions.append({'stringContains': {'key': 'title', 'value': title.lower()}})

    if filters.get('remote'):
        conditions.append({'equals': {'key': 'remote', 'value': True}})

    min_salary = filters.get('min_salary')
    if min_salary is not None:
        conditions.append({'greaterThanOrEquals': {'key': 'salary_max', 'value': min_salary}})

    max_salary = filters.get('max_salary')
    if max_salary is not None:
        conditions.append({'lessThanOrEquals': {'key': 'salary_max', 'value': max_salary}})

    if not conditions:
        return None
    if len(conditions) == 1:
        return conditions[0]
    return {'andAll': conditions}


def job_matches_filters(job, filters):
    """Predicate used in browse mode (no profile text), applied directly to
    raw job dicts fetched from S3 rather than via a Bedrock KB filter."""
    location = filters.get('location')
    if location and location.lower() not in (job.get('location') or '').lower():
        return False

    title = filters.get('title')
    if title and title.lower() not in (job.get('title') or '').lower():
        return False

    if filters.get('remote') and not job.get('remote'):
        return False

    salary_max = job.get('salary_max')
    salary_max = salary_max if salary_max is not None else SALARY_UNKNOWN_SENTINEL
    min_salary = filters.get('min_salary')
    if min_salary is not None and salary_max < min_salary:
        return False

    salary_min = job.get('salary_min')
    salary_min = salary_min if salary_min is not None else 0
    max_salary = filters.get('max_salary')
    if max_salary is not None and salary_min > max_salary:
        return False

    return True

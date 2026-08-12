def build_metadata_filter(filters):
    conditions = []

    location = filters.get('location')
    if location:
        conditions.append({'stringContains': {'key': 'location', 'value': location.lower()}})

    if filters.get('remote'):
        conditions.append({'equals': {'key': 'remote', 'value': True}})

    min_salary = filters.get('min_salary')
    if min_salary is not None:
        conditions.append({'greaterThanOrEquals': {'key': 'salary_max', 'value': min_salary}})

    if not conditions:
        return None
    if len(conditions) == 1:
        return conditions[0]
    return {'andAll': conditions}

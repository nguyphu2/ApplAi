import { getIdToken, clearTokens } from './auth.js';

const API_BASE = 'https://q3xyo18vh7.execute-api.us-east-1.amazonaws.com';

async function request(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      // The token was valid when the page loaded but has since expired or
      // been revoked - clear it and tell app.js so it can flip the UI back
      // to logged-out immediately, instead of leaving stale "Logout" state
      // showing until the user notices and logs out manually.
      clearTokens();
      window.dispatchEvent(new Event('session-expired'));
      throw new Error('your session expired — please log in again');
    }
    throw new Error(body.error || 'request failed');
  }
  return body;
}

export function search(payload) {
  // No authorizer on this route - guests search too - but a logged-in
  // caller's token lets the backend exclude jobs they marked uninterested.
  const idToken = getIdToken();
  const headers = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  return request('/match', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

export function analyze(payload) {
  return request('/match/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getSettings() {
  return request('/settings', {
    method: 'GET',
    headers: { Authorization: `Bearer ${getIdToken()}` },
  });
}

export function putSettings(payload) {
  return request('/settings', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getIdToken()}`,
    },
    body: JSON.stringify(payload),
  });
}

export function listApplications() {
  return request('/applications', {
    method: 'GET',
    headers: { Authorization: `Bearer ${getIdToken()}` },
  });
}

export function createApplication(payload) {
  return request('/applications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getIdToken()}`,
    },
    body: JSON.stringify(payload),
  });
}

export function updateApplicationStatus(applicationId, status) {
  return request(`/applications/${applicationId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getIdToken()}`,
    },
    body: JSON.stringify({ status }),
  });
}

export function deleteApplication(applicationId) {
  return request(`/applications/${applicationId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getIdToken()}` },
  });
}

export function markUninterested(job) {
  return request('/uninterested', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getIdToken()}`,
    },
    body: JSON.stringify({ job_id: job.job_id, title: job.title, company: job.company, url: job.listing_url }),
  });
}

export function listUninterested() {
  return request('/uninterested', {
    method: 'GET',
    headers: { Authorization: `Bearer ${getIdToken()}` },
  });
}

export function unmarkUninterested(jobId) {
  return request(`/uninterested/${jobId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getIdToken()}` },
  });
}

export function autocompleteLocation(query) {
  return request('/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location_query: query }),
  }).then((body) => body.suggestions);
}

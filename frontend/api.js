import { getIdToken } from './auth.js';

const API_BASE = 'https://q3xyo18vh7.execute-api.us-east-1.amazonaws.com';

async function request(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || 'request failed');
  }
  return body;
}

export function search(payload) {
  return request('/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

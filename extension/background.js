const CLIENT_ID = '5fub35eljp359gg26pdckauqvr';
const COGNITO_DOMAIN = 'https://applai-nguyphu2.auth.us-east-1.amazoncognito.com';
const API_BASE = 'https://q3xyo18vh7.execute-api.us-east-1.amazonaws.com';

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array.buffer);
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
}

async function login() {
  const redirectUri = chrome.identity.getRedirectURL();
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'openid email',
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const authUrl = `${COGNITO_DOMAIN}/login?${params.toString()}`;

  const responseUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const code = new URL(responseUrl).searchParams.get('code');
  if (!code) {
    throw new Error('login was cancelled');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error('token exchange failed');
  }
  const tokens = await response.json();
  await chrome.storage.local.set({ id_token: tokens.id_token, access_token: tokens.access_token });
}

async function logout() {
  await chrome.storage.local.remove(['id_token', 'access_token']);
}

async function isLoggedIn() {
  const { id_token } = await chrome.storage.local.get('id_token');
  return !!id_token;
}

async function getProfile() {
  const { id_token } = await chrome.storage.local.get('id_token');
  if (!id_token) {
    throw new Error('not logged in');
  }
  const response = await fetch(`${API_BASE}/settings`, {
    headers: { Authorization: `Bearer ${id_token}` },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      await chrome.storage.local.remove(['id_token', 'access_token']);
      throw new Error('your session expired — please log in again');
    }
    throw new Error('could not load your profile');
  }
  const settings = await response.json();
  return settings.profile_info || {};
}

async function fillActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error('no active tab');
  }
  const profile = await getProfile();

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (p) => { window.__applaiProfile = p; },
    args: [profile],
  });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['matcher.js', 'content.js'],
  });
}

function applyRemoteFillPlan(fills) {
  let filled = 0;
  for (const { field_id, value } of fills) {
    const field = document.querySelector(`[data-applai-field-id="${field_id}"]`);
    if (!field) continue;
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.removeAttribute('data-applai-field-id');
    filled += 1;
  }
  return filled;
}

async function handleLocalFillDone(message, tabId) {
  const { filled: localFilled, total, unmatched, pageUrl, pageTitle } = message;

  if (!unmatched || unmatched.length === 0) {
    chrome.runtime.sendMessage({ type: 'FILL_RESULT', filled: localFilled, total, remoteFilled: 0 });
    return;
  }

  try {
    const { id_token } = await chrome.storage.local.get('id_token');
    const response = await fetch(`${API_BASE}/autofill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${id_token}` },
      body: JSON.stringify({ fields: unmatched, page_url: pageUrl, page_title: pageTitle }),
    });
    if (!response.ok) {
      chrome.runtime.sendMessage({
        type: 'FILL_RESULT',
        filled: localFilled,
        total,
        remoteFilled: 0,
        remoteError: "couldn't reach ApplAI for the rest",
      });
      return;
    }
    const { fills } = await response.json();
    const [{ result: remoteFilled }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: applyRemoteFillPlan,
      args: [fills],
    });
    chrome.runtime.sendMessage({ type: 'FILL_RESULT', filled: localFilled, total, remoteFilled });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'FILL_RESULT',
      filled: localFilled,
      total,
      remoteFilled: 0,
      remoteError: err.message,
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LOGIN') {
    login()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === 'LOGOUT') {
    logout().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'CHECK_LOGIN') {
    isLoggedIn().then((loggedIn) => sendResponse({ loggedIn }));
    return true;
  }
  if (message.type === 'FILL') {
    fillActiveTab()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === 'LOCAL_FILL_DONE') {
    handleLocalFillDone(message, sender.tab.id);
    return false;
  }
});

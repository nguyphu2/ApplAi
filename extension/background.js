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

async function getDocxResumes() {
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
    throw new Error('could not load your resumes');
  }
  const settings = await response.json();
  return (settings.resumes || []).filter((r) => r.file_type === 'docx');
}

async function optimizeResume({ resumeId, targetMatchPercent, onePage, saveAsNewCopy }) {
  const { id_token } = await chrome.storage.local.get('id_token');
  if (!id_token) {
    throw new Error('not logged in');
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error('no active tab');
  }
  const { text: jobDescriptionText } = await scrapeJobDescription(tab.id);
  const response = await fetch(`${API_BASE}/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${id_token}` },
    body: JSON.stringify({
      resume_id: resumeId,
      job_description_text: jobDescriptionText,
      target_match_percent: targetMatchPercent,
      one_page: onePage,
      save_as_new_copy: saveAsNewCopy,
    }),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      await chrome.storage.local.remove(['id_token', 'access_token']);
      throw new Error('your session expired — please log in again');
    }
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'optimize failed');
  }
  return response.json();
}

// Runs inside the page (via executeScript) to decide if this looks like a
// job description/posting page, as opposed to an application form or an
// unrelated page - self-contained, no closures over background.js state,
// since executeScript serializes it into the page.
function detectJobDescriptionPage() {
  const POSTING_TERMS = [
    'responsibilities', 'requirements', 'qualifications', 'job description',
    'what you\'ll do', 'what you will do', 'about the role', 'about this role',
    'we are looking for', "we're looking for", 'skills and experience',
  ];
  const bodyText = document.body ? document.body.textContent.toLowerCase() : '';
  const termHits = POSTING_TERMS.filter((term) => bodyText.includes(term)).length;
  const EXCLUDED_INPUT_TYPES = ['hidden', 'search', 'submit', 'button'];
  const formFieldCount = Array.from(document.querySelectorAll('input, select, textarea')).filter((el) => {
    if (el.tagName === 'INPUT' && EXCLUDED_INPUT_TYPES.includes((el.type || '').toLowerCase())) return false;
    return el.offsetParent !== null;
  }).length;
  // A real posting page reliably mentions at least two of these terms and
  // isn't itself a multi-field application form (which the old autofill
  // detector already covered, and which this feature explicitly excludes
  // per the design - the optimizer only runs on the description page).
  // Only visible, meaningfully-interactive fields count - hidden inputs,
  // CSRF tokens, search boxes, and sign-in widgets shouldn't disqualify a
  // real job posting page.
  return termHits >= 2 && formFieldCount < 8;
}

async function checkJobDescriptionPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return false;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: detectJobDescriptionPage,
    });
    return !!result;
  } catch (err) {
    return false;
  }
}

async function scrapeJobDescription(tabId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error('timed out reading this page - try again'));
    }, 15000);

    const listener = (message, sender) => {
      if (message.type === 'JOB_DESCRIPTION_SCRAPED' && sender.tab && sender.tab.id === tabId) {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        chrome.runtime.onMessage.removeListener(listener);
        resolve({ text: message.text, pageTitle: message.pageTitle });
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }).catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      chrome.runtime.onMessage.removeListener(listener);
      reject(err);
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_JOB_DESCRIPTION_PAGE') {
    checkJobDescriptionPage().then((isJobDescriptionPage) => sendResponse({ isJobDescriptionPage }));
    return true;
  }
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
  if (message.type === 'GET_DOCX_RESUMES') {
    getDocxResumes()
      .then((resumes) => sendResponse({ ok: true, resumes }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === 'OPTIMIZE') {
    optimizeResume(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

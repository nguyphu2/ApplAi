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

// When the only URL we have is a fallback (the confirmation page itself,
// not the real posting - see urlIsFallback in popup.js), try to resolve
// the real catalog listing by title/company before saving a URL nobody
// else will ever match: neither the website's search-result checkmark
// nor "you've already applied to this page" on a later revisit can work
// against a one-time confirmation-page URL. Reuses /match's title filter,
// which also matches company name, so this needs no new endpoint. Only
// substitutes on an unambiguous single match - never guesses.
async function resolveCatalogListing(title, company) {
  if (!company) return null;
  try {
    const response = await fetch(`${API_BASE}/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: { title: company } }),
    });
    if (!response.ok) return null;
    const { matches } = await response.json();
    const titleLower = (title || '').toLowerCase();
    const companyLower = company.toLowerCase();
    const candidates = matches.filter((m) => {
      const companyMatches = m.company && m.company.toLowerCase().includes(companyLower);
      const titleMatches = !titleLower || (m.title && (m.title.toLowerCase().includes(titleLower) || titleLower.includes(m.title.toLowerCase())));
      return companyMatches && titleMatches;
    });
    if (candidates.length === 1) {
      return { job_id: candidates[0].job_id, url: candidates[0].listing_url };
    }
  } catch (err) {
    // Best-effort only - fall through to the caller's existing URL.
  }
  return null;
}

async function markApplied({ resumeId, override }) {
  const { id_token } = await chrome.storage.local.get('id_token');
  if (!id_token) {
    throw new Error('not logged in');
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error('no active tab');
  }

  let title;
  let company;
  let url;
  let jobId = null;
  if (override) {
    // Called from the "looks like you just applied" confirmation-page
    // prompt - the current page is a "Thank you for applying" screen, not
    // the job posting, so scraping it would get the wrong (or no) title
    // and company. Use the info remembered from the original posting.
    ({ title, company, url } = override);
    if (override.urlIsFallback) {
      const resolved = await resolveCatalogListing(title, company);
      if (resolved) {
        url = resolved.url;
        jobId = resolved.job_id;
      }
    }
  } else {
    // Scrapes the page itself (title + JobPosting structured data) rather
    // than trusting values passed in from the popup, so company is actually
    // captured instead of always going in blank.
    const scraped = await scrapeJobDescription(tab.id);
    title = scraped.pageTitle || tab.title || 'Untitled posting';
    company = scraped.company || '';
    url = tab.url;
  }

  const response = await fetch(`${API_BASE}/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${id_token}` },
    body: JSON.stringify({
      title: title || 'Untitled posting',
      company: company || '',
      url,
      job_id: jobId,
      resume_id: resumeId || null,
    }),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      await chrome.storage.local.remove(['id_token', 'access_token']);
      throw new Error('your session expired — please log in again');
    }
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'mark applied failed');
  }
  return response.json();
}

// Same normalization the website (frontend/app.js) and the backend
// (applications_lambda/handler.py normalize_url) use, so a URL captured
// here matches records created from either surface.
function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return (u.host.toLowerCase() + u.pathname).replace(/\/$/, '');
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

async function checkApplied(url) {
  const { id_token } = await chrome.storage.local.get('id_token');
  if (!id_token) {
    throw new Error('not logged in');
  }
  const response = await fetch(`${API_BASE}/applications`, {
    headers: { Authorization: `Bearer ${id_token}` },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      await chrome.storage.local.remove(['id_token', 'access_token']);
      throw new Error('your session expired — please log in again');
    }
    throw new Error('could not check applied status');
  }
  const { applications } = await response.json();
  const normalized = normalizeUrl(url);
  return applications.find((a) => a.url_normalized === normalized) || null;
}

async function deleteApplicationRecord(applicationId) {
  const { id_token } = await chrome.storage.local.get('id_token');
  if (!id_token) {
    throw new Error('not logged in');
  }
  const response = await fetch(`${API_BASE}/applications/${applicationId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${id_token}` },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      await chrome.storage.local.remove(['id_token', 'access_token']);
      throw new Error('your session expired — please log in again');
    }
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'could not remove application');
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

// Runs inside the page (via executeScript) to decide if this looks like an
// application-confirmation page ("Thank you for applying" etc), so the
// popup can offer to mark the ORIGINAL job applied even though this page
// itself isn't the posting - self-contained, no closures, same reason as
// detectJobDescriptionPage above. Also best-effort extracts title/company
// straight from the confirmation sentence itself ("Your application for
// {title} at {company} has been submitted") - many ATS vendors phrase it
// this way, and it's the only source available when the popup was never
// opened on the original posting page (so nothing was remembered for
// this tab) or the apply flow moved to a different tab along the way.
function detectApplicationConfirmationPage() {
  const CONFIRMATION_TERMS = [
    'thank you for applying', 'thank you for your application', 'thanks for applying',
    'application received', 'application submitted', 'application complete',
    "we've received your application", 'we have received your application',
    'your application has been submitted', 'successfully applied',
  ];
  const rawText = document.body ? document.body.textContent.replace(/\s+/g, ' ').trim() : '';
  const bodyText = rawText.toLowerCase();
  const isConfirmation = CONFIRMATION_TERMS.some((term) => bodyText.includes(term));
  if (!isConfirmation) {
    return { isConfirmation: false, title: '', company: '' };
  }

  const patterns = [
    /your application for (.+?) at (.+?) has been submitted/i,
    /application for (.+?) at (.+?) (?:has been submitted|was submitted|is complete)/i,
    /applied (?:to|for) (.+?) at (.+?)[.!]/i,
  ];
  for (const pattern of patterns) {
    const match = rawText.match(pattern);
    if (match) {
      return { isConfirmation: true, title: match[1].trim(), company: match[2].trim() };
    }
  }
  return { isConfirmation: true, title: '', company: '' };
}

async function checkApplicationConfirmationPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { isConfirmation: false, title: '', company: '' };
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: detectApplicationConfirmationPage,
    });
    return result || { isConfirmation: false, title: '', company: '' };
  } catch (err) {
    return { isConfirmation: false, title: '', company: '' };
  }
}

// Runs inside the page - a cheap title/company grab (no full description
// text extraction) so the popup can remember what job this tab was on,
// in case the user later lands on a confirmation page in the same tab
// where scraping the page itself would get the wrong (or no) title/company.
function extractJobBasics() {
  function guessPageTitle() {
    // og:title is curated for clean display and present on far more sites
    // than JobPosting schema (e.g. SmartRecruiters listing pages have none).
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && ogTitle.content) return ogTitle.content.trim();

    const raw = document.title.trim();
    const separators = [' | ', ' - ', ' — '];
    for (const sep of separators) {
      const idx = raw.lastIndexOf(sep);
      if (idx > 0) return raw.slice(0, idx).trim();
    }
    return raw;
  }
  function guessCompany() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch {
        continue;
      }
      const candidates = Array.isArray(data) ? data : [data];
      for (const item of candidates) {
        const type = item && item['@type'];
        const isJobPosting = type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
        const name = item && item.hiringOrganization && item.hiringOrganization.name;
        if (isJobPosting && name) return String(name).trim();
      }
    }
    const ogSiteName = document.querySelector('meta[property="og:site_name"]');
    if (ogSiteName && ogSiteName.content) return ogSiteName.content.trim();
    return '';
  }
  return { title: guessPageTitle(), company: guessCompany() };
}

async function getJobBasics() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { title: '', company: '' };
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractJobBasics,
    });
    return result || { title: '', company: '' };
  } catch (err) {
    return { title: '', company: '' };
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
        resolve({ text: message.text, pageTitle: message.pageTitle, company: message.company });
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

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove([`optimizeResult_${tabId}`, `optimizeSettings_${tabId}`, `lastJobInfo_${tabId}`]);
});

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
  if (message.type === 'MARK_APPLIED') {
    markApplied(message.payload)
      .then((application) => sendResponse({ ok: true, application }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === 'CHECK_APPLIED') {
    checkApplied(message.payload.url)
      .then((application) => sendResponse({ ok: true, application }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === 'DELETE_APPLICATION') {
    deleteApplicationRecord(message.payload.applicationId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === 'CHECK_APPLICATION_CONFIRMATION') {
    checkApplicationConfirmationPage()
      .then(({ isConfirmation, title, company }) => sendResponse({
        ok: true, isConfirmationPage: isConfirmation, extractedTitle: title, extractedCompany: company,
      }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === 'GET_JOB_BASICS') {
    getJobBasics()
      .then(({ title, company }) => sendResponse({ ok: true, title, company }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

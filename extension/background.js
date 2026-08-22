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
  // fillResults/fillInProgressTabs are keyed per-tab (see sendFillResult
  // below) so a wholesale clear on logout, rather than a single key
  // removal, is what actually resets every open tab's state.
  await chrome.storage.local.remove(['id_token', 'access_token', 'fillResults', 'fillInProgressTabs']);
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

// How many "Add Education"/"Add Work History" clicks content.js should
// make - asks Claude to read the resume, since that's unstructured text
// and can't be reliably counted with string matching. Fails closed (0/0):
// if this can't be determined, revealing zero extra blocks is a no-op,
// same as before this feature existed, rather than guessing a number and
// risking empty blocks the resume never asked for.
async function getSectionCounts() {
  const { id_token } = await chrome.storage.local.get('id_token');
  if (!id_token) {
    return { education: 0, work_history: 0 };
  }
  try {
    const response = await fetch(`${API_BASE}/autofill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${id_token}` },
      body: JSON.stringify({ mode: 'counts' }),
    });
    if (!response.ok) {
      return { education: 0, work_history: 0 };
    }
    const { counts } = await response.json();
    return {
      education: Number(counts?.education) || 0,
      work_history: Number(counts?.work_history) || 0,
    };
  } catch (err) {
    return { education: 0, work_history: 0 };
  }
}

// Runs inside the page (via executeScript) to decide if this looks like a
// job application, so Fill isn't offered on arbitrary sites. Two signals:
// a known ATS domain (covers the large majority of real postings, even
// under a company's own custom domain via CNAME, e.g. careers.company.com
// still resolving to Greenhouse/Lever), or a same-page heuristic (a resume/
// CV upload field alongside a reasonably full form) for self-built or
// unlisted application pages. Self-contained - no closures over
// background.js state, since executeScript serializes it into the page.
function detectJobApplicationPage() {
  const KNOWN_ATS_HOSTS = [
    'recruiting.paylocity.com', 'boards.greenhouse.io', 'job-boards.greenhouse.io',
    'greenhouse.io', 'jobs.lever.co', 'lever.co', 'myworkdayjobs.com',
    'icims.com', 'bamboohr.com', 'jobvite.com', 'smartrecruiters.com',
    'ashbyhq.com', 'taleo.net', 'successfactors.com', 'workable.com',
    'breezy.hr', 'recruitee.com', 'jazzhr.com', 'applytojob.com',
    'ultipro.com', 'dayforcehcm.com', 'oraclecloud.com',
  ];
  const hostname = window.location.hostname.toLowerCase();
  const hostIsKnownATS = KNOWN_ATS_HOSTS.some((h) => hostname === h || hostname.endsWith('.' + h));
  if (hostIsKnownATS) return true;

  const bodyText = document.body ? document.body.textContent.toLowerCase() : '';
  const hasResumeUpload = Array.from(document.querySelectorAll('input[type="file"]')).some((input) => {
    const context = (input.name + ' ' + input.id + ' ' + (input.closest('label')?.textContent || '')).toLowerCase();
    return /resume|cv\b/.test(context) || /resume|cv\b/.test(bodyText);
  });
  const formFieldCount = document.querySelectorAll('input, select, textarea').length;
  return hasResumeUpload && formFieldCount >= 5;
}

async function checkJobApplicationPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return false;
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: detectJobApplicationPage,
    });
    return !!result;
  } catch (err) {
    // Pages executeScript can't reach (chrome://, the Web Store, etc.)
    // fail closed - Fill has nothing to act on there anyway.
    return false;
  }
}

async function fillActiveTab(tabId) {
  const profile = await getProfile();
  const sectionCounts = await getSectionCounts();

  await chrome.scripting.executeScript({
    target: { tabId },
    func: (p, counts) => {
      window.__applaiProfile = p;
      window.__applaiSectionCounts = counts;
    },
    args: [profile, sectionCounts],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['matcher.js', 'content.js'],
  });
}

async function applyRemoteFillPlan(fills) {
  // executeScript({ func: applyRemoteFillPlan }) only serializes and
  // injects this one function's source into the page - a sibling
  // top-level function in this file (e.g. a module-level
  // fillComboboxOption) would not exist in that injected context and
  // calling it would throw a ReferenceError, aborting the whole loop
  // (including every field still queued after the one that hit it).
  // Nested here so it travels with applyRemoteFillPlan's own source.
  async function fillComboboxOption(combo, value) {
    combo.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const listboxId = combo.getAttribute('aria-owns') || combo.getAttribute('aria-controls');
    const listbox = listboxId ? document.getElementById(listboxId) : null;
    const optionEls = listbox ? Array.from(listbox.querySelectorAll('[role="option"]')) : [];
    const match = optionEls.find((opt) => opt.textContent.trim() === value);
    if (match) {
      match.click();
      return true;
    }
    combo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return false;
  }

  let filled = 0;
  let requiredFilled = 0;
  for (const { field_id, value } of fills) {
    const field = document.querySelector(`[data-applai-field-id="${field_id}"]`);
    if (!field) continue;
    const required = field.required || field.getAttribute('aria-required') === 'true';

    if (field.getAttribute('role') === 'combobox' && field.tagName !== 'SELECT') {
      const ok = await fillComboboxOption(field, value);
      if (!ok) continue;
    } else {
      if (field.value.trim()) continue;
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    filled += 1;
    if (required) {
      requiredFilled += 1;
    }
  }
  document.querySelectorAll('[data-applai-field-id]').forEach((el) => {
    el.removeAttribute('data-applai-field-id');
  });
  return { filled, requiredFilled };
}

async function sendFillResult(tabId, payload) {
  // Keyed per-tab so switching between two job application tabs shows
  // each one's own progress instead of whichever tab was filled last -
  // Chrome destroys the popup document on close, so without persisting
  // this at all, every reopen would start blank regardless of whether a
  // fill had actually just finished. Clearing this tab's fillInProgress
  // entry here too, since every terminal path of a fill goes through this
  // one function - see the FILL handler below for why that flag exists.
  const { fillResults, fillInProgressTabs } = await chrome.storage.local.get(['fillResults', 'fillInProgressTabs']);
  const nextResults = { ...fillResults, [tabId]: payload };
  const nextInProgress = { ...fillInProgressTabs };
  delete nextInProgress[tabId];
  await chrome.storage.local.set({ fillResults: nextResults, fillInProgressTabs: nextInProgress });
  chrome.runtime.sendMessage({ type: 'FILL_RESULT', tabId, ...payload }).catch(() => {});
}

async function handleLocalFillDone(message, tabId) {
  const { filled: localFilled, total, requiredTotal, requiredFilled: localRequiredFilled, unmatched, pageUrl, pageTitle } = message;

  if (!unmatched || unmatched.length === 0) {
    await sendFillResult(tabId, { filled: localFilled, total, remoteFilled: 0, requiredTotal, requiredFilled: localRequiredFilled });
    return;
  }

  const { id_token } = await chrome.storage.local.get('id_token');
  if (!id_token) {
    await sendFillResult(tabId, {
      filled: localFilled,
      total,
      remoteFilled: 0,
      requiredTotal,
      requiredFilled: localRequiredFilled,
      remoteError: 'your session expired — please log in again',
    });
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/autofill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${id_token}` },
      body: JSON.stringify({ fields: unmatched, page_url: pageUrl, page_title: pageTitle }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        await chrome.storage.local.remove(['id_token', 'access_token']);
        await sendFillResult(tabId, {
          filled: localFilled,
          total,
          remoteFilled: 0,
          requiredTotal,
          requiredFilled: localRequiredFilled,
          remoteError: 'your session expired — please log in again',
        });
        return;
      }
      await sendFillResult(tabId, {
        filled: localFilled,
        total,
        remoteFilled: 0,
        requiredTotal,
        requiredFilled: localRequiredFilled,
        remoteError: "couldn't reach ApplAI for the rest",
      });
      return;
    }
    const { fills } = await response.json();
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: applyRemoteFillPlan,
      args: [fills],
    });
    await sendFillResult(tabId, {
      filled: localFilled,
      total,
      remoteFilled: result.filled,
      requiredTotal,
      requiredFilled: localRequiredFilled + result.requiredFilled,
    });
  } catch (err) {
    await sendFillResult(tabId, {
      filled: localFilled,
      total,
      remoteFilled: 0,
      requiredTotal,
      requiredFilled: localRequiredFilled,
      remoteError: err.message,
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_JOB_PAGE') {
    checkJobApplicationPage().then((isJobPage) => sendResponse({ isJobPage }));
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
  if (message.type === 'FILL') {
    // A fill in flight is still waiting on content.js's local pass and/or
    // the /autofill round-trip when this fires - starting a second one
    // reinjects content.js, which clears every data-applai-field-id tag
    // unconditionally, so the first fill's still-pending remote response
    // arrives to find none of its target fields exist anymore and silently
    // drops all of them. This is now reachable in practice: closing the
    // popup no longer discards its state (see sendFillResult), so it's
    // easy to close it mid-fill, reopen, and click Fill again before the
    // first one has finished.
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (!tab) {
        sendResponse({ ok: false, error: 'no active tab' });
        return;
      }
      const tabId = tab.id;
      const { fillInProgressTabs } = await chrome.storage.local.get('fillInProgressTabs');
      if (fillInProgressTabs && fillInProgressTabs[tabId]) {
        sendResponse({ ok: false, error: 'Already filling this page - please wait for it to finish.' });
        return;
      }
      // The popup already hides the Fill button off job-application pages,
      // but re-checking here means a stale popup can't trigger a fill on
      // an unrelated page (e.g. left open, then the user navigates away).
      const isJobPage = await checkJobApplicationPage();
      if (!isJobPage) {
        sendResponse({ ok: false, error: "This doesn't look like a job application page." });
        return;
      }
      const { fillInProgressTabs: current } = await chrome.storage.local.get('fillInProgressTabs');
      await chrome.storage.local.set({ fillInProgressTabs: { ...current, [tabId]: true } });
      fillActiveTab(tabId)
        .then(() => sendResponse({ ok: true }))
        .catch(async (err) => {
          const { fillInProgressTabs: latest } = await chrome.storage.local.get('fillInProgressTabs');
          const next = { ...latest };
          delete next[tabId];
          await chrome.storage.local.set({ fillInProgressTabs: next });
          sendResponse({ ok: false, error: err.message });
        });
    });
    return true;
  }
  if (message.type === 'LOCAL_FILL_DONE') {
    handleLocalFillDone(message, sender.tab.id);
    return false;
  }
});

// Per-tab fill state has no other eviction path - without this, every tab
// ever filled stays in storage for the life of the browser profile.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { fillResults, fillInProgressTabs } = await chrome.storage.local.get(['fillResults', 'fillInProgressTabs']);
  if (fillResults && tabId in fillResults) {
    const next = { ...fillResults };
    delete next[tabId];
    await chrome.storage.local.set({ fillResults: next });
  }
  if (fillInProgressTabs && tabId in fillInProgressTabs) {
    const next = { ...fillInProgressTabs };
    delete next[tabId];
    await chrome.storage.local.set({ fillInProgressTabs: next });
  }
});

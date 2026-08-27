const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const optimizerForm = document.getElementById('optimizer-form');
const resumeSelect = document.getElementById('resume-select');
const matchSlider = document.getElementById('match-slider');
const matchSliderValue = document.getElementById('match-slider-value');
const saveAsNewToggle = document.getElementById('save-as-new-toggle');
const onePageToggle = document.getElementById('one-page-toggle');
const optimizeBtn = document.getElementById('optimize-btn');
const markAppliedBtn = document.getElementById('mark-applied-btn');
const notJobDescriptionPageEl = document.getElementById('not-job-description-page');
const noResumesEl = document.getElementById('no-resumes');
const confirmationPromptEl = document.getElementById('application-confirmation-prompt');
const confirmationJobInfoEl = document.getElementById('confirmation-job-info');
const confirmMarkAppliedBtn = document.getElementById('confirm-mark-applied-btn');
const dismissConfirmationBtn = document.getElementById('dismiss-confirmation-btn');
const resultEl = document.getElementById('result');
const statusEl = document.getElementById('status');
const progressEl = document.getElementById('optimize-progress');

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function resultStorageKey(tabId) {
  return `optimizeResult_${tabId}`;
}

async function restoreStoredResult(tab) {
  if (!tab) return;
  const key = resultStorageKey(tab.id);
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key];
  if (entry && entry.pageUrl === tab.url) {
    buildResultPanel(entry.result);
    resultEl.classList.remove('hidden');
  }
}

async function saveStoredResult(tab, result) {
  if (!tab) return;
  const key = resultStorageKey(tab.id);
  await chrome.storage.local.set({ [key]: { pageUrl: tab.url, result } });
}

function settingsStorageKey(tabId) {
  return `optimizeSettings_${tabId}`;
}

async function restoreStoredSettings(tab) {
  if (!tab) return;
  const key = settingsStorageKey(tab.id);
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key];
  if (entry && entry.pageUrl === tab.url) {
    matchSlider.value = entry.targetMatchPercent;
    matchSliderValue.textContent = `${entry.targetMatchPercent}%`;
    onePageToggle.checked = entry.onePage;
    saveAsNewToggle.checked = entry.saveAsNewCopy;
  }
}

async function saveStoredSettings() {
  const tab = await getActiveTab();
  if (!tab) return;
  const key = settingsStorageKey(tab.id);
  await chrome.storage.local.set({
    [key]: {
      pageUrl: tab.url,
      targetMatchPercent: Number(matchSlider.value),
      onePage: onePageToggle.checked,
      saveAsNewCopy: saveAsNewToggle.checked,
    },
  });
}

const PROGRESS_CELL_COUNT = 8;
let progressCells = [];
let progressInterval = null;

function buildProgressCells() {
  progressEl.innerHTML = '';
  progressCells = [];
  for (let i = 0; i < PROGRESS_CELL_COUNT; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    progressEl.appendChild(cell);
    progressCells.push(cell);
  }
}
buildProgressCells();

function startProgressAnimation() {
  progressEl.classList.remove('hidden');
  let index = 0;
  progressCells.forEach((cell) => cell.classList.remove('active'));
  progressInterval = setInterval(() => {
    progressCells.forEach((cell) => cell.classList.remove('active'));
    progressCells[index].classList.add('active');
    index = (index + 1) % progressCells.length;
  }, 150);
}

function stopProgressAnimation() {
  clearInterval(progressInterval);
  progressEl.classList.add('hidden');
  progressCells.forEach((cell) => cell.classList.remove('active'));
}

function setLoggedInUI(loggedIn) {
  loginBtn.classList.toggle('hidden', loggedIn);
  logoutBtn.classList.toggle('hidden', !loggedIn);
  optimizerForm.classList.toggle('hidden', !loggedIn);
}

matchSlider.addEventListener('input', () => {
  matchSliderValue.textContent = `${matchSlider.value}%`;
});
matchSlider.addEventListener('change', saveStoredSettings);
saveAsNewToggle.addEventListener('change', saveStoredSettings);
onePageToggle.addEventListener('change', saveStoredSettings);

loginBtn.addEventListener('click', async () => {
  statusEl.textContent = 'Logging in...';
  const result = await sendMessage({ type: 'LOGIN' });
  if (result.ok) {
    statusEl.textContent = '';
    setLoggedInUI(true);
    await init();
  } else {
    statusEl.textContent = result.error || 'Login failed.';
  }
});

logoutBtn.addEventListener('click', async () => {
  await sendMessage({ type: 'LOGOUT' });
  setLoggedInUI(false);
  statusEl.textContent = '';
  resultEl.classList.add('hidden');
});

optimizeBtn.addEventListener('click', async () => {
  const resumeId = resumeSelect.value;
  if (!resumeId) {
    statusEl.textContent = 'Choose a resume first.';
    return;
  }
  statusEl.textContent = '';
  resultEl.classList.add('hidden');
  optimizeBtn.disabled = true;
  optimizeBtn.textContent = 'Optimizing...';
  startProgressAnimation();
  const response = await sendMessage({
    type: 'OPTIMIZE',
    payload: {
      resumeId,
      targetMatchPercent: Number(matchSlider.value),
      onePage: onePageToggle.checked,
      saveAsNewCopy: saveAsNewToggle.checked,
    },
  });
  stopProgressAnimation();
  optimizeBtn.disabled = false;
  optimizeBtn.textContent = 'Optimize';
  if (!response.ok) {
    statusEl.textContent = response.error || 'Optimize failed.';
    return;
  }
  const result = { ...response.result, savedAsNew: saveAsNewToggle.checked };
  buildResultPanel(result);
  resultEl.classList.remove('hidden');
  const tab = await getActiveTab();
  await saveStoredResult(tab, result);
});

markAppliedBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab) return;

  markAppliedBtn.disabled = true;
  markAppliedBtn.textContent = 'Marking...';

  try {
    const key = resultStorageKey(tab.id);
    const stored = await chrome.storage.local.get(key);
    const entry = stored[key];
    const hasResultForThisPage = entry && entry.pageUrl === tab.url;

    const response = await sendMessage({
      type: 'MARK_APPLIED',
      payload: {
        resumeId: hasResultForThisPage ? (resumeSelect.value || null) : null,
      },
    });

    if (!response || !response.ok) {
      statusEl.textContent = (response && response.error) || 'Could not mark as applied.';
      return;
    }

    markAppliedBtn.textContent = '✓ Marked applied';
    markAppliedBtn.classList.add('success');
    return;
  } catch (err) {
    statusEl.textContent = err.message || 'Could not mark as applied.';
  } finally {
    if (!markAppliedBtn.classList.contains('success')) {
      markAppliedBtn.disabled = false;
      markAppliedBtn.textContent = 'Mark as applied';
    }
  }
});

confirmMarkAppliedBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  const key = `lastJobInfo_${tab.id}`;
  const stored = await chrome.storage.local.get(key);
  const jobInfo = stored[key];
  if (!jobInfo) {
    confirmationPromptEl.classList.add('hidden');
    return;
  }

  confirmMarkAppliedBtn.disabled = true;
  confirmMarkAppliedBtn.textContent = 'Marking...';

  const response = await sendMessage({
    type: 'MARK_APPLIED',
    payload: { resumeId: null, override: jobInfo },
  });

  if (!response || !response.ok) {
    statusEl.textContent = (response && response.error) || 'Could not mark as applied.';
    confirmMarkAppliedBtn.disabled = false;
    confirmMarkAppliedBtn.textContent = 'Mark as applied';
    return;
  }

  await chrome.storage.local.remove(key);
  confirmationPromptEl.classList.add('hidden');
  statusEl.textContent = 'Marked as applied!';
});

dismissConfirmationBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (tab) {
    await chrome.storage.local.remove(`lastJobInfo_${tab.id}`);
  }
  confirmationPromptEl.classList.add('hidden');
});

async function rememberJobBasics(tab) {
  const basics = await sendMessage({ type: 'GET_JOB_BASICS' });
  if (!basics.ok) return;
  await chrome.storage.local.set({
    [`lastJobInfo_${tab.id}`]: { title: basics.title, company: basics.company, url: tab.url },
  });
}

async function checkApplicationConfirmation(tab) {
  if (!tab) return;
  const response = await sendMessage({ type: 'CHECK_APPLICATION_CONFIRMATION' });
  if (!response.ok || !response.isConfirmationPage) return;

  const key = `lastJobInfo_${tab.id}`;
  const stored = await chrome.storage.local.get(key);
  let jobInfo = stored[key];

  if (!jobInfo || !jobInfo.title) {
    // Nothing was remembered for this tab (popup was never opened on the
    // original posting, or the apply flow moved to a different tab) - fall
    // back to whatever background.js could pull straight out of the
    // confirmation sentence itself ("Your application for X at Y..."),
    // using this page's own URL since the original posting URL is unknown.
    if (response.extractedTitle) {
      jobInfo = { title: response.extractedTitle, company: response.extractedCompany || '', url: tab.url };
      await chrome.storage.local.set({ [key]: jobInfo });
    } else {
      return;
    }
  }

  confirmationJobInfoEl.textContent = jobInfo.company ? ` to ${jobInfo.title} at ${jobInfo.company}` : ` to ${jobInfo.title}`;
  confirmationPromptEl.classList.remove('hidden');
}

// Asks the server (not local per-tab storage) whether this URL is already
// tracked as applied, so a fresh tab on a posting you already marked from
// elsewhere still shows the right state instead of defaulting to unmarked.
async function checkAppliedState(tab) {
  if (!tab) return;
  const response = await sendMessage({ type: 'CHECK_APPLIED', payload: { url: tab.url } });
  if (response.ok && response.application) {
    markAppliedBtn.textContent = '✓ Marked applied';
    markAppliedBtn.classList.add('success');
    markAppliedBtn.disabled = true;
  }
}

function buildResultPanel({ match_score_before, match_score_after, missing_keywords, red_flags, filename, savedAsNew }) {
  resultEl.innerHTML = '';

  const savedLine = document.createElement('div');
  savedLine.textContent = `${savedAsNew ? 'Saved as' : 'Updated'}: ${filename}`;
  resultEl.appendChild(savedLine);

  function appendBar(label, value, fillClass) {
    const labelRow = document.createElement('div');
    labelRow.className = 'bar-label';
    const labelText = document.createElement('span');
    labelText.textContent = label;
    const valueText = document.createElement('span');
    valueText.textContent = `${value}%`;
    labelRow.append(labelText, valueText);
    resultEl.appendChild(labelRow);

    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = `bar-fill ${fillClass}`;
    fill.style.width = `${value}%`;
    track.appendChild(fill);
    resultEl.appendChild(track);
  }

  appendBar('Before match', match_score_before, 'before');
  appendBar('After match', match_score_after, 'after');

  function appendDropdown(heading, items, listClass) {
    const details = document.createElement('details');
    details.className = 'dropdown';
    const summary = document.createElement('summary');
    summary.textContent = `${heading} (${items.length})`;
    details.appendChild(summary);
    const ul = document.createElement('ul');
    ul.className = listClass;
    for (const item of items) {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    }
    details.appendChild(ul);
    resultEl.appendChild(details);
  }

  appendDropdown('Missing keywords', missing_keywords, 'missing-keywords');
  appendDropdown('Red flags', red_flags, 'red-flags');
}

async function init() {
  const { loggedIn } = await sendMessage({ type: 'CHECK_LOGIN' });
  setLoggedInUI(loggedIn);
  if (!loggedIn) return;

  const { isJobDescriptionPage } = await sendMessage({ type: 'CHECK_JOB_DESCRIPTION_PAGE' });
  optimizerForm.classList.toggle('hidden', !isJobDescriptionPage);

  if (!isJobDescriptionPage) {
    const tab = await getActiveTab();
    await checkApplicationConfirmation(tab);
    notJobDescriptionPageEl.classList.toggle('hidden', !confirmationPromptEl.classList.contains('hidden'));
    return;
  }
  notJobDescriptionPageEl.classList.add('hidden');

  const tab = await getActiveTab();
  await restoreStoredSettings(tab);
  await restoreStoredResult(tab);
  await checkAppliedState(tab);
  await rememberJobBasics(tab);

  const resumesResponse = await sendMessage({ type: 'GET_DOCX_RESUMES' });
  if (!resumesResponse.ok) {
    statusEl.textContent = resumesResponse.error || 'Could not load resumes.';
    return;
  }
  const resumes = resumesResponse.resumes;
  if (resumes.length === 0) {
    noResumesEl.classList.remove('hidden');
    optimizerForm.classList.add('hidden');
    return;
  }
  resumeSelect.innerHTML = '';
  for (const r of resumes) {
    const option = document.createElement('option');
    option.value = r.id;
    option.textContent = r.filename;
    resumeSelect.appendChild(option);
  }
}

init();

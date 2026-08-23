const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const optimizerForm = document.getElementById('optimizer-form');
const resumeSelect = document.getElementById('resume-select');
const matchSlider = document.getElementById('match-slider');
const matchSliderValue = document.getElementById('match-slider-value');
const saveAsNewToggle = document.getElementById('save-as-new-toggle');
const onePageToggle = document.getElementById('one-page-toggle');
const optimizeBtn = document.getElementById('optimize-btn');
const notJobDescriptionPageEl = document.getElementById('not-job-description-page');
const noResumesEl = document.getElementById('no-resumes');
const resultEl = document.getElementById('result');
const statusEl = document.getElementById('status');

function sendMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
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

function setLoggedInUI(loggedIn) {
  loginBtn.classList.toggle('hidden', loggedIn);
  logoutBtn.classList.toggle('hidden', !loggedIn);
  optimizerForm.classList.toggle('hidden', !loggedIn);
}

matchSlider.addEventListener('input', () => {
  matchSliderValue.textContent = `${matchSlider.value}%`;
});

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
  const response = await sendMessage({
    type: 'OPTIMIZE',
    payload: {
      resumeId,
      targetMatchPercent: Number(matchSlider.value),
      onePage: onePageToggle.checked,
      saveAsNewCopy: saveAsNewToggle.checked,
    },
  });
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
  notJobDescriptionPageEl.classList.toggle('hidden', isJobDescriptionPage);
  optimizerForm.classList.toggle('hidden', !isJobDescriptionPage);
  if (!isJobDescriptionPage) return;

  const tab = await getActiveTab();
  await restoreStoredResult(tab);

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

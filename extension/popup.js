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
  buildResultPanel({ ...response.result, savedAsNew: saveAsNewToggle.checked });
  resultEl.classList.remove('hidden');
});

function buildResultPanel({ match_score_before, match_score_after, missing_keywords, red_flags, filename, savedAsNew }) {
  resultEl.innerHTML = '';

  const scoreRow = document.createElement('div');
  scoreRow.className = 'score-row';
  const before = document.createElement('span');
  before.className = 'before';
  before.textContent = `${match_score_before}%`;
  const after = document.createElement('span');
  after.className = 'after';
  after.textContent = `${match_score_after}% match`;
  scoreRow.append(before, ' → ', after);
  resultEl.appendChild(scoreRow);

  const savedLine = document.createElement('div');
  savedLine.textContent = `${savedAsNew ? 'Saved as' : 'Updated'}: ${filename}`;
  resultEl.appendChild(savedLine);

  function appendList(heading, items) {
    const h = document.createElement('h4');
    h.textContent = heading;
    resultEl.appendChild(h);
    const ul = document.createElement('ul');
    for (const item of items) {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    }
    resultEl.appendChild(ul);
  }

  appendList('Missing keywords (before)', missing_keywords);
  appendList('Red flags (before)', red_flags);
}

async function init() {
  const { loggedIn } = await sendMessage({ type: 'CHECK_LOGIN' });
  setLoggedInUI(loggedIn);
  if (!loggedIn) return;

  const { isJobDescriptionPage } = await sendMessage({ type: 'CHECK_JOB_DESCRIPTION_PAGE' });
  notJobDescriptionPageEl.classList.toggle('hidden', isJobDescriptionPage);
  optimizerForm.classList.toggle('hidden', !isJobDescriptionPage);
  if (!isJobDescriptionPage) return;

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

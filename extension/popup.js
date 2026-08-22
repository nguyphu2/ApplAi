const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const fillBtn = document.getElementById('fill-btn');
const notJobPageEl = document.getElementById('not-job-page');
const statusEl = document.getElementById('status');

const fillProgressEl = document.getElementById('fill-progress');
const fillStateIcon = document.getElementById('fill-state-icon');
const fillStateLabel = document.getElementById('fill-state-label');
const fieldsProgressTrack = document.getElementById('fields-progress-track');
const fieldsProgressFill = document.getElementById('fields-progress-fill');
const fieldsProgressCount = document.getElementById('fields-progress-count');
const requiredProgressTrack = document.getElementById('required-progress-track');
const requiredProgressFill = document.getElementById('required-progress-fill');
const requiredProgressCount = document.getElementById('required-progress-count');

function sendMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function setLoggedInUI(loggedIn, isJobPage) {
  loginBtn.classList.toggle('hidden', loggedIn);
  logoutBtn.classList.toggle('hidden', !loggedIn);
  fillBtn.classList.toggle('hidden', !loggedIn || !isJobPage);
  notJobPageEl.classList.toggle('hidden', !loggedIn || isJobPage);
}

function setBar(trackEl, fillEl, countEl, done, total) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  fillEl.style.width = `${pct}%`;
  countEl.textContent = `${done} / ${total}`;
  trackEl.classList.remove('indeterminate');
}

function startFillProgress() {
  fillProgressEl.classList.remove('hidden');
  fillStateIcon.classList.remove('done');
  fillStateIcon.textContent = '…';
  fillStateLabel.textContent = 'Filling this page...';
  fieldsProgressTrack.classList.add('indeterminate');
  requiredProgressTrack.classList.add('indeterminate');
  fieldsProgressCount.textContent = '0 / 0';
  requiredProgressCount.textContent = '0 / 0';
  fillBtn.disabled = true;
}

function finishFillProgress(message) {
  fillProgressEl.classList.remove('hidden');
  fillStateIcon.classList.add('done');
  fillStateIcon.textContent = '✓';
  fillStateLabel.textContent = message.remoteError ? 'Filled what it could' : 'Done';

  const totalFilled = message.filled + (message.remoteFilled || 0);
  setBar(fieldsProgressTrack, fieldsProgressFill, fieldsProgressCount, totalFilled, message.total);
  setBar(requiredProgressTrack, requiredProgressFill, requiredProgressCount, message.requiredFilled || 0, message.requiredTotal || 0);

  fillBtn.disabled = false;
  statusEl.textContent = message.remoteError ? `${message.filled} filled locally; ${message.remoteError}.` : '';
}

loginBtn.addEventListener('click', async () => {
  statusEl.textContent = 'Logging in...';
  const result = await sendMessage({ type: 'LOGIN' });
  if (result.ok) {
    statusEl.textContent = '';
    const { isJobPage } = await sendMessage({ type: 'CHECK_JOB_PAGE' });
    setLoggedInUI(true, isJobPage);
  } else {
    statusEl.textContent = result.error || 'Login failed.';
  }
});

logoutBtn.addEventListener('click', async () => {
  await sendMessage({ type: 'LOGOUT' });
  setLoggedInUI(false, false);
  statusEl.textContent = '';
  fillProgressEl.classList.add('hidden');
});

(async function init() {
  const { loggedIn } = await sendMessage({ type: 'CHECK_LOGIN' });
  const isJobPage = loggedIn ? (await sendMessage({ type: 'CHECK_JOB_PAGE' })).isJobPage : false;
  setLoggedInUI(loggedIn, isJobPage);
  if (loggedIn) {
    const { fillInProgress, lastFillResult } = await chrome.storage.local.get(['fillInProgress', 'lastFillResult']);
    if (fillInProgress) {
      // A fill is still waiting on content.js/the /autofill round-trip
      // from before this popup instance existed - show the same live
      // state a fresh click would, and leave the button disabled so a
      // second fill can't be started on top of it (see the FILL handler
      // in background.js for what that race does).
      startFillProgress();
    } else if (lastFillResult) {
      finishFillProgress(lastFillResult);
    }
  }
})();

fillBtn.addEventListener('click', async () => {
  statusEl.textContent = '';
  startFillProgress();
  const result = await sendMessage({ type: 'FILL' });
  if (!result.ok) {
    fillProgressEl.classList.add('hidden');
    fillBtn.disabled = false;
    statusEl.textContent = result.error || 'Fill failed.';
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'FILL_RESULT') {
    finishFillProgress(message);
  }
});

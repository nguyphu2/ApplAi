const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const fillBtn = document.getElementById('fill-btn');
const statusEl = document.getElementById('status');

function sendMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function setLoggedInUI(loggedIn) {
  loginBtn.classList.toggle('hidden', loggedIn);
  logoutBtn.classList.toggle('hidden', !loggedIn);
  fillBtn.classList.toggle('hidden', !loggedIn);
}

loginBtn.addEventListener('click', async () => {
  statusEl.textContent = 'Logging in...';
  const result = await sendMessage({ type: 'LOGIN' });
  if (result.ok) {
    statusEl.textContent = '';
    setLoggedInUI(true);
  } else {
    statusEl.textContent = result.error || 'Login failed.';
  }
});

logoutBtn.addEventListener('click', async () => {
  await sendMessage({ type: 'LOGOUT' });
  setLoggedInUI(false);
  statusEl.textContent = '';
});

(async function init() {
  const { loggedIn } = await sendMessage({ type: 'CHECK_LOGIN' });
  setLoggedInUI(loggedIn);
})();

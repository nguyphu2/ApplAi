import { login, logout, handleCallback, isLoggedIn } from './auth.js';
import { search, analyze, getSettings, putSettings } from './api.js';

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const tabSearch = document.getElementById('tab-search');
const tabProfile = document.getElementById('tab-profile');
const searchSection = document.getElementById('search-section');
const profileSection = document.getElementById('profile-section');
const profileLoggedOut = document.getElementById('profile-logged-out');
const profileLoggedIn = document.getElementById('profile-logged-in');
const profileSkillsText = document.getElementById('profile-skills-text');
const matchForm = document.getElementById('match-form');
const resultsEl = document.getElementById('results');

let lastProfileText = '';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderError(container, message) {
  container.innerHTML = `<div class="error-message">${message}</div>`;
}

function renderMatches(matches) {
  if (matches.length === 0) {
    resultsEl.innerHTML = '<p>No matches found.</p>';
    return;
  }
  resultsEl.innerHTML = matches.map((job) => `
    <div class="job-card" data-job-id="${job.job_id}">
      <h3>${job.title}</h3>
      <div class="meta">
        ${job.company} — ${job.location}${job.remote ? ' (Remote)' : ''}
        ${job.salary_min ? ` — $${job.salary_min.toLocaleString()}-$${job.salary_max.toLocaleString()}` : ''}
      </div>
      <a href="${job.listing_url}" target="_blank" rel="noopener">View listing</a>
      <button class="secondary analyze-btn">Job match analysis</button>
      <div class="analysis-result"></div>
    </div>
  `).join('');

  resultsEl.querySelectorAll('.analyze-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.job-card');
      const jobId = card.dataset.jobId;
      const analysisEl = card.querySelector('.analysis-result');
      btn.disabled = true;
      btn.textContent = 'Analyzing...';
      try {
        const result = await analyze({ job_id: jobId, profile_text: lastProfileText });
        analysisEl.innerHTML = `
          <div class="analysis">
            <p>${result.explanation}</p>
            ${result.skill_gaps.length ? `<p><strong>Skill gaps:</strong> ${result.skill_gaps.join(', ')}</p>` : ''}
          </div>
        `;
        btn.remove();
      } catch (err) {
        renderError(analysisEl, err.message);
        btn.disabled = false;
        btn.textContent = 'Job match analysis';
      }
    });
  });
}

matchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  resultsEl.innerHTML = '';

  const resumeFile = document.getElementById('resume-file').files[0];
  const skillsText = document.getElementById('skills-text').value;
  const filters = {};
  const location = document.getElementById('filter-location').value;
  const remote = document.getElementById('filter-remote').checked;
  const salary = document.getElementById('filter-salary').value;
  if (location) filters.location = location;
  if (remote) filters.remote = true;
  if (salary) filters.min_salary = parseInt(salary, 10);

  const payload = { skills_text: skillsText, filters };
  if (resumeFile) {
    payload.resume_pdf_base64 = await fileToBase64(resumeFile);
  }

  try {
    const result = await search(payload);
    lastProfileText = result.profile_text;
    renderMatches(result.matches);

    if (isLoggedIn()) {
      putSettings({ skills_text: skillsText, filters }).catch(() => {});
    }
  } catch (err) {
    renderError(resultsEl, err.message);
  }
});

function showTab(name) {
  const isSearch = name === 'search';
  searchSection.classList.toggle('hidden', !isSearch);
  profileSection.classList.toggle('hidden', isSearch);
  tabSearch.classList.toggle('active', isSearch);
  tabProfile.classList.toggle('active', !isSearch);
}

tabSearch.addEventListener('click', () => showTab('search'));
tabProfile.addEventListener('click', async () => {
  showTab('profile');
  if (!isLoggedIn()) {
    profileLoggedOut.classList.remove('hidden');
    profileLoggedIn.classList.add('hidden');
    return;
  }
  profileLoggedOut.classList.add('hidden');
  profileLoggedIn.classList.remove('hidden');
  try {
    const settings = await getSettings();
    profileSkillsText.value = settings.skills_text;
    document.getElementById('profile-status').textContent = '';
  } catch (err) {
    document.getElementById('profile-status').textContent = err.message;
  }
});

loginBtn.addEventListener('click', () => login());
logoutBtn.addEventListener('click', () => logout());

function updateAuthUI() {
  loginBtn.classList.toggle('hidden', isLoggedIn());
  logoutBtn.classList.toggle('hidden', !isLoggedIn());
}

(async function init() {
  await handleCallback();
  updateAuthUI();
})();

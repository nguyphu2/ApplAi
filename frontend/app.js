import { login, logout, handleCallback, isLoggedIn } from './auth.js';
import { search, analyze, getSettings, putSettings, autocompleteLocation } from './api.js';

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const tabSearch = document.getElementById('tab-search');
const tabProfile = document.getElementById('tab-profile');
const tabQuestions = document.getElementById('tab-questions');
const searchSection = document.getElementById('search-section');
const profileSection = document.getElementById('profile-section');
const questionsSection = document.getElementById('questions-section');
const profileLoggedOut = document.getElementById('profile-logged-out');
const profileLoggedIn = document.getElementById('profile-logged-in');
const questionsLoggedOut = document.getElementById('questions-logged-out');
const questionsLoggedIn = document.getElementById('questions-logged-in');
const profileSkillsText = document.getElementById('profile-skills-text');
const profileStatus = document.getElementById('profile-status');
const saveSkillsBtn = document.getElementById('save-skills-btn');
const editSkillsBtn = document.getElementById('edit-skills-btn');
const deleteSkillsBtn = document.getElementById('delete-skills-btn');
const profileFullName = document.getElementById('profile-full-name');
const profileFirstName = document.getElementById('profile-first-name');
const profileLastName = document.getElementById('profile-last-name');
const profileEmail = document.getElementById('profile-email');
const profilePhone = document.getElementById('profile-phone');
const profileWorkAuthorization = document.getElementById('profile-work-authorization');
const profileAddress = document.getElementById('profile-address');
const profileCity = document.getElementById('profile-city');
const profileState = document.getElementById('profile-state');
const profileZipCode = document.getElementById('profile-zip-code');
const profileLinkedinUrl = document.getElementById('profile-linkedin-url');
const profilePortfolioUrl = document.getElementById('profile-portfolio-url');
const saveProfileInfoBtn = document.getElementById('save-profile-info-btn');
const editProfileInfoBtn = document.getElementById('edit-profile-info-btn');

const PROFILE_INFO_FIELDS = [
  ['full_name', profileFullName],
  ['first_name', profileFirstName],
  ['last_name', profileLastName],
  ['email', profileEmail],
  ['phone', profilePhone],
  ['work_authorization', profileWorkAuthorization],
  ['address', profileAddress],
  ['city', profileCity],
  ['state', profileState],
  ['zip_code', profileZipCode],
  ['linkedin_url', profileLinkedinUrl],
  ['portfolio_url', profilePortfolioUrl],
];

const resumeNoneCheckbox = document.getElementById('resume-none');
const resumeListEl = document.getElementById('resume-list');
const resumeUploadInput = document.getElementById('resume-upload');
const resumeUploadClearBtn = document.getElementById('resume-upload-clear');
const resumeUploadBtn = document.getElementById('resume-upload-btn');
const matchForm = document.getElementById('match-form');
const resultsEl = document.getElementById('results');
const titleInput = document.getElementById('filter-title');

const filtersToggle = document.getElementById('filters-toggle');
const filtersPanel = document.getElementById('filters-panel');
const filtersToggleArrow = document.getElementById('filters-toggle-arrow');
const filtersResetBtn = document.getElementById('filters-reset');
const locationInput = document.getElementById('filter-location');
const locationSuggestionsEl = document.getElementById('location-suggestions');
const remoteCheckbox = document.getElementById('filter-remote');
const salaryMinInput = document.getElementById('filter-salary-min');
const salaryMaxInput = document.getElementById('filter-salary-max');
const salaryMinLabel = document.getElementById('salary-min-label');
const salaryMaxLabel = document.getElementById('salary-max-label');
const relevanceInput = document.getElementById('filter-relevance');
const relevanceLabel = document.getElementById('relevance-label');
const sortBySelect = document.getElementById('sort-by');

const SALARY_MAX = 250000;

let lastMatches = [];
let profileSettings = { skills_text: '', filters: {}, resumes: [], active_resume_ids: [] };
const RESULTS_PAGE_SIZE = 10;
let visibleCount = RESULTS_PAGE_SIZE;

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

function showComicBubble(anchorEl, message) {
  const bubble = document.createElement('div');
  bubble.className = 'comic-bubble';
  bubble.textContent = message;
  document.body.appendChild(bubble);

  const rect = anchorEl.getBoundingClientRect();
  bubble.style.top = `${rect.top + window.scrollY}px`;
  bubble.style.left = `${rect.right + window.scrollX + 12}px`;

  const bubbleRect = bubble.getBoundingClientRect();
  if (bubbleRect.right > window.innerWidth - 8) {
    bubble.style.left = `${rect.left + window.scrollX - bubbleRect.width - 12}px`;
    bubble.classList.add('bubble-left');
  }

  setTimeout(() => bubble.classList.add('fade-out'), 3700);
  setTimeout(() => bubble.remove(), 4000);
}

function formatSalaryLabel(value) {
  return value >= SALARY_MAX ? `$${SALARY_MAX / 1000}k+` : `$${(value / 1000).toFixed(0)}k`;
}

function updateSalaryRangeUI() {
  let min = parseInt(salaryMinInput.value, 10);
  let max = parseInt(salaryMaxInput.value, 10);
  if (min > max) {
    [min, max] = [max, min];
    salaryMinInput.value = min;
    salaryMaxInput.value = max;
  }
  salaryMinLabel.textContent = formatSalaryLabel(min);
  salaryMaxLabel.textContent = formatSalaryLabel(max);
}

salaryMinInput.addEventListener('input', updateSalaryRangeUI);
salaryMaxInput.addEventListener('input', updateSalaryRangeUI);
updateSalaryRangeUI();

function updateRelevanceUI() {
  const value = parseInt(relevanceInput.value, 10);
  relevanceLabel.textContent = `${value}%+ match`;
}

relevanceInput.addEventListener('input', () => {
  updateRelevanceUI();
  if (lastMatches.length > 0) {
    renderMatches();
  }
});
updateRelevanceUI();

filtersToggle.addEventListener('click', () => {
  const isHidden = filtersPanel.classList.toggle('hidden');
  filtersToggleArrow.textContent = isHidden ? '▾' : '▴';
});

filtersResetBtn.addEventListener('click', () => {
  locationInput.value = '';
  hideLocationSuggestions();
  remoteCheckbox.checked = false;
  salaryMinInput.value = 0;
  salaryMaxInput.value = SALARY_MAX;
  updateSalaryRangeUI();
  relevanceInput.value = 0;
  updateRelevanceUI();
  sortBySelect.value = 'relevance';
  if (lastMatches.length > 0) {
    renderMatches();
  }
});

// --- Location autocomplete ---

let locationDebounceTimer = null;

function hideLocationSuggestions() {
  locationSuggestionsEl.classList.add('hidden');
  locationSuggestionsEl.innerHTML = '';
}

locationInput.addEventListener('input', () => {
  const query = locationInput.value.trim();
  clearTimeout(locationDebounceTimer);
  if (!query) {
    hideLocationSuggestions();
    return;
  }
  locationDebounceTimer = setTimeout(async () => {
    try {
      const suggestions = await autocompleteLocation(query);
      if (suggestions.length === 0) {
        hideLocationSuggestions();
        return;
      }
      locationSuggestionsEl.innerHTML = suggestions.map((loc) => `<li>${loc}</li>`).join('');
      locationSuggestionsEl.classList.remove('hidden');
    } catch (err) {
      hideLocationSuggestions();
    }
  }, 200);
});

locationSuggestionsEl.addEventListener('click', (event) => {
  if (event.target.tagName === 'LI') {
    locationInput.value = event.target.textContent;
    hideLocationSuggestions();
  }
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.location-field')) {
    hideLocationSuggestions();
  }
});

// --- Search / results ---

function sortMatches(matches, sortBy) {
  const sorted = [...matches];
  if (sortBy === 'recent-desc') {
    sorted.sort((a, b) => (b.ingested_at || '').localeCompare(a.ingested_at || ''));
  } else if (sortBy === 'recent-asc') {
    sorted.sort((a, b) => (a.ingested_at || '').localeCompare(b.ingested_at || ''));
  } else {
    sorted.sort((a, b) => (b.match_score ?? -1) - (a.match_score ?? -1));
  }
  return sorted;
}

function filterByRelevance(matches) {
  const threshold = parseInt(relevanceInput.value, 10);
  if (threshold === 0) {
    return matches;
  }
  return matches.filter((job) => job.match_score !== null && job.match_score !== undefined && job.match_score >= threshold);
}

const MATCH_BAR_SHADES = [
  '#dbe9fe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6',
  '#2563eb', '#1e50c4', '#1d4ed8', '#1e3a8a', '#0a1f44',
];

function matchBarColor(score) {
  const bucket = Math.min(9, Math.floor(score / 10));
  return MATCH_BAR_SHADES[bucket];
}

function renderMatches() {
  const allMatches = sortMatches(filterByRelevance(lastMatches), sortBySelect.value);

  if (allMatches.length === 0) {
    resultsEl.innerHTML = '<p>No matches found.</p>';
    return;
  }

  const matches = allMatches.slice(0, visibleCount);

  resultsEl.innerHTML = matches.map((job) => `
    <div class="job-card" data-job-id="${job.job_id}" data-listing-url="${job.listing_url}">
      ${job.match_score !== null && job.match_score !== undefined ? `
        <div class="match-bar-row">
          <div class="match-bar-track"><div class="match-bar-fill" style="width: ${job.match_score}%; background: ${matchBarColor(job.match_score)}"></div></div>
          <span class="match-bar-label">${job.match_score}% match</span>
        </div>
      ` : ''}
      <h3 class="job-title">${job.title}</h3>
      <div class="meta">
        <span class="company-name">${job.company}</span> — ${job.location}${job.remote ? ' (Remote)' : ''}
        ${job.salary_min ? ` — $${job.salary_min.toLocaleString()}-$${job.salary_max.toLocaleString()}` : ''}
      </div>
      ${job.ingested_at ? `<div class="posted-date">${new Date(job.ingested_at).toLocaleDateString()}</div>` : ''}
      <div class="analyze-row">
        <button class="secondary analyze-btn">${isLoggedIn() ? 'Job match analysis' : '🔒 Job match analysis'}</button>
        <div class="analysis-result"></div>
      </div>
    </div>
  `).join('');

  if (allMatches.length > matches.length) {
    resultsEl.insertAdjacentHTML('beforeend', '<button type="button" id="load-more-btn" class="secondary">Load more</button>');
    document.getElementById('load-more-btn').addEventListener('click', () => {
      visibleCount += RESULTS_PAGE_SIZE;
      renderMatches();
    });
  }

  resultsEl.querySelectorAll('.job-card').forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.closest('.analyze-row')) {
        return;
      }
      window.open(card.dataset.listingUrl, '_blank', 'noopener');
    });
  });

  resultsEl.querySelectorAll('.analyze-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.job-card');
      const jobId = card.dataset.jobId;
      const analysisEl = card.querySelector('.analysis-result');

      if (!isLoggedIn()) {
        showComicBubble(btn, '🔒 Log in or sign up first.');
        return;
      }

      const settings = await getSettings();
      profileSettings = settings;
      if (settings.active_resume_ids.length === 0) {
        showComicBubble(btn, '🔒 Upload a resume first.');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Analyzing...';
      try {
        const result = await analyze({ job_id: jobId, profile_text: await buildProfileText() });
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

sortBySelect.addEventListener('change', () => {
  if (lastMatches.length > 0) {
    renderMatches();
  }
});

async function buildProfileText() {
  if (!isLoggedIn()) {
    return '';
  }
  const settings = await getSettings();
  profileSettings = settings;
  const activeResumeText = settings.resumes
    .filter((r) => settings.active_resume_ids.includes(r.id))
    .map((r) => r.text);
  return [settings.skills_text, ...activeResumeText].filter(Boolean).join('\n');
}

matchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  visibleCount = RESULTS_PAGE_SIZE;
  resultsEl.innerHTML = '<p class="results-status">Searching...</p>';
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const filters = {};
  const title = titleInput.value.trim();
  const location = locationInput.value;
  const remote = remoteCheckbox.checked;
  const minSalary = parseInt(salaryMinInput.value, 10);
  const maxSalary = parseInt(salaryMaxInput.value, 10);
  if (title) filters.title = title;
  if (location) filters.location = location;
  if (remote) filters.remote = true;
  if (minSalary > 0) filters.min_salary = minSalary;
  if (maxSalary < SALARY_MAX) filters.max_salary = maxSalary;

  try {
    const skillsText = await buildProfileText();
    const result = await search({ skills_text: skillsText, filters });
    lastMatches = result.matches;
    renderMatches();
  } catch (err) {
    renderError(resultsEl, err.message);
  }
});

// --- Profile tab ---

function renderResumeList() {
  const { resumes, active_resume_ids } = profileSettings;
  resumeNoneCheckbox.checked = active_resume_ids.length === 0;

  if (resumes.length === 0) {
    resumeListEl.innerHTML = '<p class="results-status">No resumes uploaded yet.</p>';
  } else {
    resumeListEl.innerHTML = resumes.map((r) => `
      <div class="resume-row" data-resume-id="${r.id}">
        <input type="checkbox" class="resume-checkbox" ${active_resume_ids.includes(r.id) ? 'checked' : ''} />
        <span class="resume-filename">${r.filename}</span>
        <span class="resume-uploaded-at">${new Date(r.uploaded_at).toLocaleDateString()}</span>
        <button type="button" class="secondary resume-remove-btn">Remove</button>
      </div>
    `).join('');
  }

  resumeListEl.querySelectorAll('.resume-row').forEach((row) => {
    const resumeId = row.dataset.resumeId;

    row.querySelector('.resume-checkbox').addEventListener('change', async () => {
      const checkedIds = [...resumeListEl.querySelectorAll('.resume-checkbox')]
        .map((cb, i) => (cb.checked ? resumes[i].id : null))
        .filter(Boolean);
      await saveActiveResumeIds(checkedIds);
    });

    row.querySelector('.resume-remove-btn').addEventListener('click', async () => {
      try {
        profileSettings = await putSettings({ remove_resume_id: resumeId });
        renderResumeList();
      } catch (err) {
        profileStatus.textContent = err.message;
      }
    });
  });
}

async function saveActiveResumeIds(activeIds) {
  try {
    profileSettings = await putSettings({ active_resume_ids: activeIds });
    renderResumeList();
  } catch (err) {
    profileStatus.textContent = err.message;
  }
}

resumeNoneCheckbox.addEventListener('change', async () => {
  if (resumeNoneCheckbox.checked) {
    await saveActiveResumeIds([]);
  }
});

function setSkillsMode(mode) {
  const isView = mode === 'view';
  profileSkillsText.disabled = isView;
  saveSkillsBtn.classList.toggle('hidden', isView);
  editSkillsBtn.classList.toggle('hidden', !isView);
  deleteSkillsBtn.classList.toggle('hidden', !isView);
}

saveSkillsBtn.addEventListener('click', async () => {
  try {
    profileSettings = await putSettings({ skills_text: profileSkillsText.value });
    setSkillsMode(profileSettings.skills_text ? 'view' : 'edit');
    profileStatus.textContent = 'Skills saved.';
  } catch (err) {
    profileStatus.textContent = err.message;
  }
});

editSkillsBtn.addEventListener('click', () => {
  setSkillsMode('edit');
  profileSkillsText.focus();
});

deleteSkillsBtn.addEventListener('click', async () => {
  try {
    profileSettings = await putSettings({ skills_text: '' });
    profileSkillsText.value = '';
    setSkillsMode('edit');
    profileStatus.textContent = 'Skills deleted.';
  } catch (err) {
    profileStatus.textContent = err.message;
  }
});

function setProfileInfoMode(mode) {
  const isView = mode === 'view';
  PROFILE_INFO_FIELDS.forEach(([, input]) => { input.disabled = isView; });
  saveProfileInfoBtn.classList.toggle('hidden', isView);
  editProfileInfoBtn.classList.toggle('hidden', !isView);
}

function fillProfileInfoFields(profileInfo) {
  profileInfo = profileInfo || {};
  PROFILE_INFO_FIELDS.forEach(([key, input]) => {
    input.value = profileInfo[key] || '';
  });
}

function readProfileInfoFields() {
  const profileInfo = {};
  PROFILE_INFO_FIELDS.forEach(([key, input]) => {
    if (input.value.trim()) {
      profileInfo[key] = input.value.trim();
    }
  });
  return profileInfo;
}

function hasAnyProfileInfo(profileInfo) {
  return Object.keys(profileInfo || {}).length > 0;
}

saveProfileInfoBtn.addEventListener('click', async () => {
  try {
    profileSettings = await putSettings({ profile_info: readProfileInfoFields() });
    setProfileInfoMode(hasAnyProfileInfo(profileSettings.profile_info) ? 'view' : 'edit');
    profileStatus.textContent = 'Personal info saved.';
  } catch (err) {
    console.error('failed to save personal info:', err);
    showComicBubble(saveProfileInfoBtn, "Couldn't save your info — try again in a moment.");
  }
});

editProfileInfoBtn.addEventListener('click', () => {
  setProfileInfoMode('edit');
  profileFullName.focus();
});

function setResumeUploadButtonsVisible(visible) {
  resumeUploadBtn.classList.toggle('hidden', !visible);
  resumeUploadClearBtn.classList.toggle('hidden', !visible);
}

resumeUploadInput.addEventListener('change', () => {
  setResumeUploadButtonsVisible(!!resumeUploadInput.files[0]);
});

resumeUploadClearBtn.addEventListener('click', () => {
  resumeUploadInput.value = '';
  setResumeUploadButtonsVisible(false);
});

resumeUploadBtn.addEventListener('click', async () => {
  const file = resumeUploadInput.files[0];
  if (!file) {
    profileStatus.textContent = 'Choose a PDF first.';
    return;
  }
  resumeUploadBtn.disabled = true;
  resumeUploadBtn.textContent = 'Uploading...';
  try {
    const resume_pdf_base64 = await fileToBase64(file);
    profileSettings = await putSettings({ add_resume: { filename: file.name, resume_pdf_base64 } });
    renderResumeList();
    resumeUploadInput.value = '';
    setResumeUploadButtonsVisible(false);
    profileStatus.textContent = 'Resume uploaded.';
  } catch (err) {
    profileStatus.textContent = err.message;
  } finally {
    resumeUploadBtn.disabled = false;
    resumeUploadBtn.textContent = 'Upload';
  }
});

function showTab(name) {
  searchSection.classList.toggle('hidden', name !== 'search');
  profileSection.classList.toggle('hidden', name !== 'profile');
  questionsSection.classList.toggle('hidden', name !== 'questions');
  tabSearch.classList.toggle('active', name === 'search');
  tabProfile.classList.toggle('active', name === 'profile');
  tabQuestions.classList.toggle('active', name === 'questions');
}

tabSearch.addEventListener('click', () => showTab('search'));
tabQuestions.addEventListener('click', () => {
  showTab('questions');
  questionsLoggedOut.classList.toggle('hidden', isLoggedIn());
  questionsLoggedIn.classList.toggle('hidden', !isLoggedIn());
});
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
    profileSettings = await getSettings();
    profileSkillsText.value = profileSettings.skills_text;
    setSkillsMode(profileSettings.skills_text ? 'view' : 'edit');
    renderResumeList();
    fillProfileInfoFields(profileSettings.profile_info);
    setProfileInfoMode(hasAnyProfileInfo(profileSettings.profile_info) ? 'view' : 'edit');
    profileStatus.textContent = '';
  } catch (err) {
    console.error('failed to load profile:', err);
    showComicBubble(tabProfile, "Couldn't load your profile — try again in a moment.");
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

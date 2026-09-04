import { login, logout, handleCallback, isLoggedIn } from './auth.js';
import { search, analyze, getSettings, putSettings, autocompleteLocation, listApplications, createApplication, updateApplicationStatus, deleteApplication, markUninterested, listUninterested, unmarkUninterested } from './api.js';

const appMainEl = document.getElementById('app-main');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const tabSearch = document.getElementById('tab-search');
const tabProfile = document.getElementById('tab-profile');
const tabApplications = document.getElementById('tab-applications');
const searchSection = document.getElementById('search-section');
const profileSection = document.getElementById('profile-section');
const applicationsSection = document.getElementById('applications-section');
const profileLoggedOut = document.getElementById('profile-logged-out');
const profileLoggedIn = document.getElementById('profile-logged-in');
const applicationsLoggedOut = document.getElementById('applications-logged-out');
const applicationsLoggedIn = document.getElementById('applications-logged-in');
const applicationsFunnelEl = document.getElementById('applications-funnel');
const applicationsSearchInput = document.getElementById('applications-search');
const applicationsTableBody = document.getElementById('applications-table-body');
const applicationsEmptyEl = document.getElementById('applications-empty');
const applicationsPaginationEl = document.getElementById('applications-pagination');
const applicationsPageInfoEl = document.getElementById('applications-page-info');
const applicationsPrevPageBtn = document.getElementById('applications-prev-page');
const applicationsNextPageBtn = document.getElementById('applications-next-page');
const applicationsSubtabTracked = document.getElementById('applications-subtab-tracked');
const applicationsSubtabUninterested = document.getElementById('applications-subtab-uninterested');
const applicationsTrackedView = document.getElementById('applications-tracked-view');
const applicationsUninterestedView = document.getElementById('applications-uninterested-view');
const uninterestedTableBody = document.getElementById('uninterested-table-body');
const uninterestedEmptyEl = document.getElementById('uninterested-empty');
const APPLICATIONS_EMPTY_TEXT = applicationsEmptyEl.textContent;
const profileSkillsText = document.getElementById('profile-skills-text');
const profileStatus = document.getElementById('profile-status');
const saveSkillsBtn = document.getElementById('save-skills-btn');
const editSkillsBtn = document.getElementById('edit-skills-btn');
const deleteSkillsBtn = document.getElementById('delete-skills-btn');
const profileFirstName = document.getElementById('profile-first-name');
const profileLastName = document.getElementById('profile-last-name');
const profileEmail = document.getElementById('profile-email');
const profilePhone = document.getElementById('profile-phone');
const profileAddress = document.getElementById('profile-address');
const saveProfileInfoBtn = document.getElementById('save-profile-info-btn');
const editProfileInfoBtn = document.getElementById('edit-profile-info-btn');

const PROFILE_INFO_FIELDS = [
  ['first_name', profileFirstName],
  ['last_name', profileLastName],
  ['email', profileEmail],
  ['phone', profilePhone],
  ['address', profileAddress],
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
let applications = [];
const STATUS_LIST = ['Applied', '1st Stage', '2nd Stage', '3rd Stage', 'Offer', 'Offer Declined', 'Rejected'];

function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return (u.host.toLowerCase() + u.pathname).replace(/\/$/, '');
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

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

function applicationsByUrl() {
  const map = new Map();
  for (const a of applications) map.set(a.url_normalized, a);
  return map;
}

// Exact URL match only - AbbVie (and plenty of other companies) post the
// same-ish title to many distinct locations as separate real postings, so
// a title+company fuzzy match would falsely show "Applied" on a posting
// you never actually applied to. See background.js's markApplied /
// resolveCatalogListing for why the stored URL is sometimes a resolved
// catalog URL rather than the raw page URL you were marking from.
function findApplicationForJob(job, appliedByUrlMap) {
  return (appliedByUrlMap || applicationsByUrl()).get(normalizeUrl(job.listing_url || '')) || null;
}

function renderMatches() {
  const allMatches = sortMatches(filterByRelevance(lastMatches), sortBySelect.value);

  if (allMatches.length === 0) {
    resultsEl.innerHTML = '<p>No matches found.</p>';
    return;
  }

  const matches = allMatches.slice(0, visibleCount);
  // Was rebuilding the full applications Map from scratch inside
  // findApplicationForJob on every call - O(matches x applications) instead
  // of O(matches + applications) once the applications list has any real
  // size. Build it once here and pass it through.
  const appliedByUrlMap = applicationsByUrl();
  const appliedByJobId = new Map();
  for (const job of matches) {
    const existing = findApplicationForJob(job, appliedByUrlMap);
    if (existing) appliedByJobId.set(job.job_id, existing);
  }

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
        <div class="applied-uninterested-row">
          ${job.listing_url ? `
          <button class="job-applied-toggle${appliedByJobId.has(job.job_id) ? ' applied' : ''}">${isLoggedIn() ? (appliedByJobId.has(job.job_id) ? '✓ Applied' : 'Mark applied') : '🔒 Mark applied'}</button>
          ` : '<button class="job-applied-toggle" disabled title="No listing URL available">Mark applied</button>'}
          <button class="secondary uninterested-btn">${isLoggedIn() ? 'Uninterested' : '🔒 Uninterested'}</button>
        </div>
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

      const settings = await loadProfileSettings();
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

  resultsEl.querySelectorAll('.job-applied-toggle').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const card = btn.closest('.job-card');
      const jobId = card.dataset.jobId;
      const listingUrl = card.dataset.listingUrl;
      const job = allMatches.find((m) => m.job_id === jobId);

      if (!isLoggedIn()) {
        showComicBubble(btn, '🔒 Log in or sign up first.');
        return;
      }
      if (!listingUrl) {
        return;
      }

      const existing = findApplicationForJob(job);

      btn.disabled = true;
      try {
        if (existing) {
          await deleteApplication(existing.application_id);
          applications = applications.filter((a) => a.application_id !== existing.application_id);
          btn.textContent = 'Mark applied';
          btn.classList.remove('applied');
        } else {
          const activeResumeIds = profileSettings.active_resume_ids || [];
          const resumeId = activeResumeIds.length === 1 ? activeResumeIds[0] : null;
          const created = await createApplication({
            title: job.title,
            company: job.company,
            url: listingUrl,
            job_id: jobId,
            resume_id: resumeId,
          });
          applications = [...applications, created];
          btn.textContent = '✓ Applied';
          btn.classList.add('applied');
        }
      } catch (err) {
        showComicBubble(btn, err.message || "Couldn't update — try again.");
      } finally {
        btn.disabled = false;
      }
    });
  });

  resultsEl.querySelectorAll('.uninterested-btn').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const card = btn.closest('.job-card');
      const jobId = card.dataset.jobId;
      const job = allMatches.find((m) => m.job_id === jobId);

      if (!isLoggedIn()) {
        showComicBubble(btn, '🔒 Log in or sign up first.');
        return;
      }

      btn.disabled = true;
      try {
        await markUninterested(job);
        lastMatches = lastMatches.filter((m) => m.job_id !== jobId);
        renderMatches();
      } catch (err) {
        showComicBubble(btn, err.message || "Couldn't update — try again.");
        btn.disabled = false;
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
  // Was an unconditional getSettings() call on every single search - each
  // resume's full extracted text comes back in that payload, so re-fetching
  // it per search added a full round trip for data that had almost always
  // already been loaded this session and hadn't changed. Same
  // profileSettingsLoaded cache activateProfileTab/activateApplicationsTab
  // already trust; every settings mutation in this file updates
  // profileSettings in place, so the cache never goes stale mid-session.
  await loadProfileSettings();
  const activeResumeText = profileSettings.resumes
    .filter((r) => profileSettings.active_resume_ids.includes(r.id))
    .map((r) => r.text);
  return [profileSettings.skills_text, ...activeResumeText].filter(Boolean).join('\n');
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
    // Independent requests - applications only need to finish before
    // renderMatches reads them for the checkmark, not before search
    // starts. Was awaited sequentially after search(), adding its full
    // round trip on top of search latency for no reason.
    const applicationsPromise = isLoggedIn()
      ? loadApplications().catch((err) => console.error('failed to load applications for checkmark matching:', err))
      : Promise.resolve();
    const [result] = await Promise.all([search({ skills_text: skillsText, filters }), applicationsPromise]);
    lastMatches = result.matches;
    renderMatches();
  } catch (err) {
    renderError(resultsEl, err.message);
  }
});

// --- Applications tab ---

// Main pipeline chain, left to right. Sankey node height at stage i is
// the CUMULATIVE count of applications whose status is stage i or later
// in this list (an app currently at "3rd Stage" is assumed to have
// flowed through 1st and 2nd first, and "Offer Declined" is assumed to
// have flowed through "Offer" first - both reasonable, since you can't
// decline an offer you never received. The data model has no
// status-history log, so this ordinal assumption is the best honest
// approximation of "how far did each application get" available).
// Rejected is NOT part of this chain - a rejection can happen after any
// round, and there's no way to know which one, so instead of fabricating
// a stage it branches directly off the Applied node as its own flow.
const FUNNEL_STAGES = ['Applied', '1st Stage', '2nd Stage', '3rd Stage', 'Offer', 'Offer Declined'];
// Flat two-tone scheme (navy nodes/still-progressing + a single light-blue
// ribbon color), with a third accent reserved for the one branch that
// leaves the chain (Rejected) - modeled on the flerlagetwins.com sankey
// funnel: flat solid fills, no per-stage gradient, so color alone marks
// "still in the pipeline" vs. "dropped out" instead of a rainbow per stage.
const FUNNEL_NODE_COLOR = '#0a1f44';
const FUNNEL_RIBBON_COLOR = '#a9cce3';
const REJECTED_COLOR = '#e2776c';
const SVG_NS = 'http://www.w3.org/2000/svg';
// Wide flat blocks, not slim pills - matches the reference's rectangular
// bars. Square corners (radius 0) instead of stadium ends, also per
// reference. Labels stay above the bar rather than centered inside it like
// the reference: our labels include a live count ("Offer Declined (3)")
// that's longer than the reference's plain stage names, and white label
// text spilling past a narrow navy bar onto the page's white background
// would go invisible.
const FUNNEL_NODE_WIDTH = 70;
const FUNNEL_NODE_RADIUS = 0;
const FUNNEL_RIBBON_WIDTH = 120;
const FUNNEL_MIN_BLOCK_HEIGHT = 24;

let applicationsStatusFilter = null;

function applicationsStatusCounts() {
  const counts = { Applied: applications.length };
  for (const status of STATUS_LIST.slice(1)) {
    counts[status] = applications.filter((a) => a.status === status).length;
  }
  return counts;
}

// cumulative[i] = how many applications reached FUNNEL_STAGES[i] or later
// (Rejected is excluded from this chain entirely - see note above).
function funnelCumulativeCounts(exactCounts) {
  const cumulative = new Array(FUNNEL_STAGES.length).fill(0);
  for (let i = FUNNEL_STAGES.length - 1; i >= 0; i--) {
    cumulative[i] = exactCounts[FUNNEL_STAGES[i]] + (i + 1 < FUNNEL_STAGES.length ? cumulative[i + 1] : 0);
  }
  return cumulative;
}

function toggleApplicationsStatusFilter(status) {
  applicationsStatusFilter = applicationsStatusFilter === status ? null : status;
  applicationsPage = 1;
  renderApplicationsFunnel();
  renderApplicationsTable();
}

// A flowing ribbon between two vertical edges that may sit at different x
// AND y positions (the main chain ribbons keep y1===y2; the Rejected
// branch uses different y's to visually drop to its own row), tapering
// from width1 at the start to width2 at the end - width1 !== width2
// whenever some applicants stayed at the source stage instead of
// advancing, so the ribbon narrows to show that drop-off instead of
// stepping down abruptly right at the node edge.
function sankeyRibbonPath(x1, y1, x2, y2, width1, width2) {
  const midX = (x1 + x2) / 2;
  const y1b = y1 + width1;
  const y2b = y2 + width2;
  return `M ${x1} ${y1} C ${midX} ${y1} ${midX} ${y2} ${x2} ${y2} `
    + `L ${x2} ${y2b} C ${midX} ${y2b} ${midX} ${y1b} ${x1} ${y1b} Z`;
}

function appendFunnelRibbonLabel(svg, x, y, count) {
  const label = document.createElementNS(SVG_NS, 'text');
  label.setAttribute('x', x);
  label.setAttribute('y', y);
  label.setAttribute('text-anchor', 'middle');
  label.classList.add('funnel-ribbon-label');
  label.textContent = count;
  svg.appendChild(label);
}

function appendFunnelNode(svg, stage, exactCount, x, y, height, color, tooltipText) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.classList.add('funnel-node');
  if (applicationsStatusFilter === stage) g.classList.add('active');
  g.setAttribute('tabindex', '0');
  g.setAttribute('role', 'button');
  g.setAttribute('aria-pressed', String(applicationsStatusFilter === stage));

  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', x);
  rect.setAttribute('y', y);
  rect.setAttribute('width', FUNNEL_NODE_WIDTH);
  rect.setAttribute('height', height);
  rect.setAttribute('rx', FUNNEL_NODE_RADIUS);
  rect.setAttribute('fill', color);
  g.appendChild(rect);

  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = tooltipText;
  g.appendChild(title);

  // Above the bar, not centered inside it - a slim 18px bar has no room
  // for "Offer Declined" or any other label text.
  const label = document.createElementNS(SVG_NS, 'text');
  label.setAttribute('x', x + FUNNEL_NODE_WIDTH / 2);
  label.setAttribute('y', y - 8);
  label.setAttribute('text-anchor', 'middle');
  label.classList.add('funnel-node-label');
  label.textContent = `${stage} (${exactCount})`;
  g.appendChild(label);

  function activate() {
    toggleApplicationsStatusFilter(stage);
  }
  g.addEventListener('click', activate);
  g.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  });

  svg.appendChild(g);
}

function renderApplicationsFunnel() {
  const exactCounts = applicationsStatusCounts();
  const cumulative = funnelCumulativeCounts(exactCounts);
  const total = applications.length;
  const maxCount = Math.max(1, total);

  const columnStep = FUNNEL_NODE_WIDTH + FUNNEL_RIBBON_WIDTH;
  // Sized to the actual number of stages, not a fixed guess - a fixed
  // width silently clipped "Offer Declined" off the right edge once the
  // chain grew from 5 to 6 stages.
  const svgWidth = FUNNEL_STAGES.length * FUNNEL_NODE_WIDTH + (FUNNEL_STAGES.length - 1) * FUNNEL_RIBBON_WIDTH + 20;
  // Labels now sit above each bar (see appendFunnelNode) instead of
  // centered inside it, so topY needs enough headroom to not clip them.
  const topY = 28;
  const mainRowMaxHeight = 190;
  const branchGap = 34;
  const scale = mainRowMaxHeight / maxCount;

  const xFor = (i) => i * columnStep;
  const heightFor = (count) => (count > 0 ? Math.max(count * scale, FUNNEL_MIN_BLOCK_HEIGHT) : 0);

  const rejectedHeight = heightFor(exactCounts.Rejected);
  const branchY = topY + mainRowMaxHeight + branchGap;
  const svgHeight = exactCounts.Rejected > 0 ? branchY + rejectedHeight + 10 : topY + mainRowMaxHeight + 10;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Application pipeline flow by status');
  svg.classList.add('funnel-svg');

  // Applied's bar shows the FULL total (everyone who ever applied), not
  // just cumulative[0], so the Rejected branch has a visible slice of it
  // to split off from. Every later stage shows cumulative[i] as before.
  const nodeHeights = FUNNEL_STAGES.map((stage, i) => (i === 0 ? heightFor(total) : heightFor(cumulative[i])));

  // Ribbons first, so node rectangles paint on top at each end. Tapers
  // from nodeHeights[i] (everyone who reached this stage) to
  // nodeHeights[i+1] (everyone who continued past it) - anyone who stayed
  // at stage i without advancing shows up as the ribbon narrowing right
  // where it leaves that node, instead of the node and ribbon disagreeing
  // in height and creating a hard step at the junction.
  for (let i = 0; i < FUNNEL_STAGES.length - 1; i++) {
    const flowCount = cumulative[i + 1];
    if (flowCount <= 0) continue;
    const width1 = nodeHeights[i];
    const width2 = nodeHeights[i + 1];
    const x1 = xFor(i) + FUNNEL_NODE_WIDTH;
    const x2 = xFor(i + 1);

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', sankeyRibbonPath(x1, topY, x2, topY, width1, width2));
    path.setAttribute('fill', FUNNEL_RIBBON_COLOR);
    path.classList.add('funnel-ribbon');
    svg.appendChild(path);

    appendFunnelRibbonLabel(svg, (x1 + x2) / 2, topY + Math.max(width1, width2) / 2 + 4, flowCount);
  }

  // Rejected branch - splits off the bottom slice of the Applied node
  // (the honest place to show it, since we don't know which round each
  // rejection actually happened after) down to its own row.
  if (exactCounts.Rejected > 0) {
    const branchX1 = xFor(0) + FUNNEL_NODE_WIDTH;
    const branchY1 = topY + nodeHeights[0] - rejectedHeight;
    const branchX2 = xFor(1);

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', sankeyRibbonPath(branchX1, branchY1, branchX2, branchY, rejectedHeight, rejectedHeight));
    path.setAttribute('fill', REJECTED_COLOR);
    path.classList.add('funnel-ribbon', 'funnel-ribbon-rejected');
    svg.appendChild(path);

    appendFunnelRibbonLabel(svg, (branchX1 + branchX2) / 2, (branchY1 + branchY) / 2 + rejectedHeight / 2 + 4, exactCounts.Rejected);

    appendFunnelNode(
      svg, 'Rejected', exactCounts.Rejected, xFor(1), branchY, rejectedHeight, REJECTED_COLOR,
      `Rejected: ${exactCounts.Rejected}`,
    );
  }

  FUNNEL_STAGES.forEach((stage, i) => {
    appendFunnelNode(
      svg, stage, exactCounts[stage], xFor(i), topY, nodeHeights[i], FUNNEL_NODE_COLOR,
      `${stage}: ${exactCounts[stage]} currently here (${i === 0 ? total : cumulative[i]} reached this stage or later)`,
    );
  });

  applicationsFunnelEl.innerHTML = '';
  applicationsFunnelEl.appendChild(svg);
}

const APPLICATIONS_PAGE_SIZE = 10;
let applicationsSearchQuery = '';
let applicationsSortKey = 'applied_at';
let applicationsSortDir = 'desc';
let applicationsPage = 1;

function applicationSortValue(a, resume, key) {
  if (key === 'company') return (a.company || '').toLowerCase();
  if (key === 'title') return (a.title || '').toLowerCase();
  if (key === 'status') return (a.status || '').toLowerCase();
  if (key === 'resume') return resume ? resume.filename.toLowerCase() : '';
  if (key === 'applied_at') return a.applied_at || '';
  return '';
}

function updateApplicationsSortIndicators() {
  document.querySelectorAll('#applications-table th.sortable').forEach((th) => {
    th.classList.toggle('sorted-asc', th.dataset.sortKey === applicationsSortKey && applicationsSortDir === 'asc');
    th.classList.toggle('sorted-desc', th.dataset.sortKey === applicationsSortKey && applicationsSortDir === 'desc');
  });
}

function renderApplicationsTable() {
  const withResumes = applications.map((a) => ({ app: a, resume: profileSettings.resumes.find((r) => r.id === a.resume_id) }));

  const query = applicationsSearchQuery.trim().toLowerCase();
  let filtered = withResumes.filter(({ app }) => !applicationsStatusFilter || app.status === applicationsStatusFilter);
  if (query) {
    filtered = filtered.filter(({ app }) => (app.company || '').toLowerCase().includes(query) || (app.title || '').toLowerCase().includes(query));
  }

  filtered.sort((a, b) => {
    const va = applicationSortValue(a.app, a.resume, applicationsSortKey);
    const vb = applicationSortValue(b.app, b.resume, applicationsSortKey);
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return applicationsSortDir === 'asc' ? cmp : -cmp;
  });

  if (applications.length === 0) {
    applicationsEmptyEl.textContent = APPLICATIONS_EMPTY_TEXT;
  } else if (filtered.length === 0) {
    applicationsEmptyEl.textContent = query || applicationsStatusFilter
      ? 'No applications match your search/filter.'
      : 'No applications tracked yet.';
  }
  applicationsEmptyEl.classList.toggle('hidden', filtered.length > 0);
  updateApplicationsSortIndicators();

  const totalPages = Math.max(1, Math.ceil(filtered.length / APPLICATIONS_PAGE_SIZE));
  if (applicationsPage > totalPages) applicationsPage = totalPages;
  if (applicationsPage < 1) applicationsPage = 1;
  const pageStart = (applicationsPage - 1) * APPLICATIONS_PAGE_SIZE;
  const pageItems = filtered.slice(pageStart, pageStart + APPLICATIONS_PAGE_SIZE);

  applicationsPaginationEl.classList.toggle('hidden', filtered.length <= APPLICATIONS_PAGE_SIZE);
  applicationsPageInfoEl.textContent = `Page ${applicationsPage} of ${totalPages}`;
  applicationsPrevPageBtn.disabled = applicationsPage <= 1;
  applicationsNextPageBtn.disabled = applicationsPage >= totalPages;

  applicationsTableBody.innerHTML = '';

  pageItems.forEach(({ app: a, resume }) => {
    const row = document.createElement('tr');
    row.dataset.applicationId = a.application_id;

    const companyCell = document.createElement('td');
    companyCell.textContent = a.company || '—';
    if (a.company) companyCell.title = a.company;

    const titleCell = document.createElement('td');
    const link = document.createElement('a');
    link.href = a.url;
    link.textContent = a.title;
    link.title = a.title;
    link.target = '_blank';
    link.rel = 'noopener';
    titleCell.appendChild(link);

    const statusCell = document.createElement('td');
    statusCell.className = 'col-status';
    const select = document.createElement('select');
    select.className = 'application-status-select';
    STATUS_LIST.forEach((s) => {
      const option = document.createElement('option');
      option.value = s;
      option.textContent = s;
      if (s === a.status) option.selected = true;
      select.appendChild(option);
    });
    statusCell.appendChild(select);

    const resumeCell = document.createElement('td');
    resumeCell.textContent = resume ? resume.filename : '—';
    if (resume) resumeCell.title = resume.filename;

    const dateCell = document.createElement('td');
    dateCell.textContent = a.applied_at ? new Date(a.applied_at).toLocaleDateString() : '—';

    const removeCell = document.createElement('td');
    removeCell.className = 'col-remove';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'secondary delete-btn application-remove-btn';
    removeBtn.textContent = 'Remove';
    removeCell.appendChild(removeBtn);

    row.append(companyCell, titleCell, statusCell, resumeCell, dateCell, removeCell);
    applicationsTableBody.appendChild(row);

    const applicationId = a.application_id;
    const previousStatus = a.status;

    select.addEventListener('change', async (event) => {
      try {
        const updated = await updateApplicationStatus(applicationId, event.target.value);
        applications = applications.map((app) => (app.application_id === applicationId ? updated : app));
        renderApplicationsFunnel();
        renderApplicationsTable();
      } catch (err) {
        console.error('failed to update application status:', err);
        event.target.value = previousStatus;
      }
    });

    removeBtn.addEventListener('click', async () => {
      try {
        await deleteApplication(applicationId);
        applications = applications.filter((app) => app.application_id !== applicationId);
        renderApplicationsFunnel();
        renderApplicationsTable();
        if (lastMatches.length > 0) renderMatches();
      } catch (err) {
        console.error('failed to delete application:', err);
        row.classList.add('row-error');
        removeBtn.textContent = "Couldn't remove — try again";
      }
    });
  });
}

async function loadApplications() {
  applications = (await listApplications()).applications;
  renderApplicationsFunnel();
  renderApplicationsTable();
}

// --- Uninterested sub-page ---

let uninterestedJobs = [];
let uninterestedLoaded = false;

function renderUninterestedTable() {
  uninterestedEmptyEl.classList.toggle('hidden', uninterestedJobs.length > 0);
  const sorted = [...uninterestedJobs].sort((a, b) => (b.marked_at || '').localeCompare(a.marked_at || ''));

  uninterestedTableBody.innerHTML = '';
  sorted.forEach((job) => {
    const row = document.createElement('tr');

    const companyCell = document.createElement('td');
    companyCell.textContent = job.company || '—';

    const titleCell = document.createElement('td');
    if (job.url) {
      const link = document.createElement('a');
      link.href = job.url;
      link.textContent = job.title || '—';
      link.target = '_blank';
      link.rel = 'noopener';
      titleCell.appendChild(link);
    } else {
      titleCell.textContent = job.title || '—';
    }

    const markedCell = document.createElement('td');
    markedCell.textContent = job.marked_at ? new Date(job.marked_at).toLocaleDateString() : '—';

    const bringBackCell = document.createElement('td');
    const bringBackBtn = document.createElement('button');
    bringBackBtn.type = 'button';
    bringBackBtn.className = 'secondary';
    bringBackBtn.textContent = 'Bring back';
    bringBackBtn.addEventListener('click', async () => {
      bringBackBtn.disabled = true;
      try {
        await unmarkUninterested(job.job_id);
        uninterestedJobs = uninterestedJobs.filter((j) => j.job_id !== job.job_id);
        renderUninterestedTable();
      } catch (err) {
        bringBackBtn.disabled = false;
        bringBackBtn.textContent = "Couldn't restore — try again";
      }
    });
    bringBackCell.appendChild(bringBackBtn);

    row.append(companyCell, titleCell, markedCell, bringBackCell);
    uninterestedTableBody.appendChild(row);
  });
}

async function activateApplicationsSubtab(name) {
  applicationsSubtabTracked.classList.toggle('active', name === 'tracked');
  applicationsSubtabUninterested.classList.toggle('active', name === 'uninterested');
  applicationsTrackedView.classList.toggle('hidden', name !== 'tracked');
  applicationsUninterestedView.classList.toggle('hidden', name !== 'uninterested');

  if (name === 'uninterested' && !uninterestedLoaded) {
    try {
      uninterestedJobs = (await listUninterested()).uninterested;
      uninterestedLoaded = true;
      renderUninterestedTable();
    } catch (err) {
      console.error('failed to load uninterested jobs:', err);
      uninterestedEmptyEl.textContent = "Couldn't load your uninterested jobs — try again.";
      uninterestedEmptyEl.classList.remove('hidden');
    }
  }
}

applicationsSubtabTracked.addEventListener('click', () => activateApplicationsSubtab('tracked'));
applicationsSubtabUninterested.addEventListener('click', () => activateApplicationsSubtab('uninterested'));

applicationsSearchInput.addEventListener('input', () => {
  applicationsSearchQuery = applicationsSearchInput.value;
  applicationsPage = 1;
  renderApplicationsTable();
});

document.querySelectorAll('#applications-table th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sortKey;
    if (applicationsSortKey === key) {
      applicationsSortDir = applicationsSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      applicationsSortKey = key;
      applicationsSortDir = 'asc';
    }
    applicationsPage = 1;
    renderApplicationsTable();
  });
});

applicationsPrevPageBtn.addEventListener('click', () => {
  applicationsPage -= 1;
  renderApplicationsTable();
});

applicationsNextPageBtn.addEventListener('click', () => {
  applicationsPage += 1;
  renderApplicationsTable();
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
        ${r.file_url
          ? `<a class="resume-filename" href="${r.file_url}" target="_blank" rel="noopener">${r.filename}</a>`
          : `<span class="resume-filename">${r.filename}</span>`}
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
  profileFirstName.focus();
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
    profileStatus.textContent = 'Choose a DOCX first.';
    return;
  }
  resumeUploadBtn.disabled = true;
  resumeUploadBtn.textContent = 'Uploading...';
  try {
    const resume_docx_base64 = await fileToBase64(file);
    profileSettings = await putSettings({ add_resume: { filename: file.name, resume_docx_base64 } });
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
  applicationsSection.classList.toggle('hidden', name !== 'applications');
  tabSearch.classList.toggle('active', name === 'search');
  tabProfile.classList.toggle('active', name === 'profile');
  tabApplications.classList.toggle('active', name === 'applications');
  appMainEl.classList.toggle('wide', name === 'applications');
  if (window.location.hash !== `#${name}`) {
    // replaceState (not location.hash =) so this doesn't fire our own
    // hashchange listener and double-activate the tab - hashchange should
    // only fire for real back/forward/bookmark navigation.
    history.replaceState(null, '', `#${name}`);
  }
}

let profileSettingsLoaded = false;
let profileSettingsPromise = null;

// Single in-flight request shared by every caller (init's preload,
// activateProfileTab, activateApplicationsTab, buildProfileText) so a
// fetch already kicked off at login isn't duplicated by whichever of them
// runs next - they all just await the same promise.
function loadProfileSettings() {
  if (!profileSettingsLoaded && !profileSettingsPromise) {
    profileSettingsPromise = getSettings()
      .then((settings) => {
        profileSettings = settings;
        profileSettingsLoaded = true;
        return settings;
      })
      .catch((err) => {
        profileSettingsPromise = null;
        throw err;
      });
  }
  return profileSettingsPromise || Promise.resolve(profileSettings);
}

// Unlike profile settings, the applications list is expected to change
// often (new applications, status updates), so activateApplicationsTab
// always wants a fresh fetch on every visit - this only dedupes the one
// preload fired at login against whichever tab activation happens to run
// first. Consumed once: the reference is cleared the moment anything reads
// it, so later tab visits fall through to a normal loadApplications() call.
let applicationsPreloadPromise = null;
function preloadApplications() {
  if (!applicationsPreloadPromise) {
    applicationsPreloadPromise = loadApplications();
  }
  return applicationsPreloadPromise;
}

async function activateSearchTab() {
  showTab('search');
}

async function activateApplicationsTab() {
  showTab('applications');
  applicationsLoggedOut.classList.toggle('hidden', isLoggedIn());
  applicationsLoggedIn.classList.toggle('hidden', !isLoggedIn());
  if (!isLoggedIn()) return;
  await activateApplicationsSubtab('tracked');
  try {
    // getSettings (for resume filenames) and listApplications are
    // independent - only the render step after needs both, so fetch them
    // together instead of one after the other. loadApplications renders
    // internally using whatever profileSettings has *right now*, so on a
    // cold first load (profileSettingsLoaded still false) it can render
    // before settings arrives - re-render once settings lands to pick up
    // the resume filenames it needed. A no-op extra render on every later
    // visit, since settingsPromise then resolves immediately.
    const wasLoaded = profileSettingsLoaded;
    const applicationsPromise = applicationsPreloadPromise || loadApplications();
    applicationsPreloadPromise = null;
    await Promise.all([loadProfileSettings(), applicationsPromise]);
    if (!wasLoaded) {
      renderApplicationsFunnel();
      renderApplicationsTable();
    }
  } catch (err) {
    console.error('failed to load applications:', err);
    applicationsEmptyEl.textContent = "Couldn't load your applications — try again.";
    applicationsEmptyEl.classList.remove('hidden');
  }
}

async function activateProfileTab() {
  showTab('profile');
  if (!isLoggedIn()) {
    profileLoggedOut.classList.remove('hidden');
    profileLoggedIn.classList.add('hidden');
    return;
  }
  profileLoggedOut.classList.add('hidden');
  profileLoggedIn.classList.remove('hidden');
  try {
    await loadProfileSettings();
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
}

tabSearch.addEventListener('click', () => activateSearchTab());
tabApplications.addEventListener('click', () => activateApplicationsTab());
tabProfile.addEventListener('click', () => activateProfileTab());

loginBtn.addEventListener('click', () => login());
logoutBtn.addEventListener('click', () => logout());

function updateAuthUI() {
  loginBtn.classList.toggle('hidden', isLoggedIn());
  logoutBtn.classList.toggle('hidden', !isLoggedIn());
}

function activateTabFromHash() {
  const name = window.location.hash.replace('#', '');
  if (name === 'profile') return activateProfileTab();
  if (name === 'applications') return activateApplicationsTab();
  return activateSearchTab();
}

window.addEventListener('hashchange', activateTabFromHash);

// Fired by api.js the moment any request comes back 401/403 - the token
// looked valid when the page loaded but the session has since died
// server-side. Without this, the Login/Logout button and whichever tab is
// showing stay stuck in their logged-in state until the user manually logs
// out and notices nothing happened.
window.addEventListener('session-expired', () => {
  updateAuthUI();
  activateTabFromHash();
});

(async function init() {
  await handleCallback();
  updateAuthUI();
  if (isLoggedIn()) {
    loadProfileSettings();
    preloadApplications();
  }
  await activateTabFromHash();
})();

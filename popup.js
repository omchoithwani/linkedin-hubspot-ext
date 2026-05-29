const HS_BASE = 'https://api.hubspot.com';

const main = document.getElementById('mainContent');

document.getElementById('settingsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ── Render helpers ──────────────────────────────────────────────────────────

function showInfo(html) {
  main.innerHTML = `<div class="status info">${html}</div>`;
}

function renderFields(mode, data) {
  const badge = mode === 'company'
    ? '<span class="mode-badge company">🏢 Company</span>'
    : '<span class="mode-badge">👤 Contact</span>';

  const rows = buildRows(mode, data)
    .map(({ label, value }) => {
      const cls = value ? 'field-value' : 'field-value not-found';
      const display = value || 'Not found';
      return `
        <div class="field-row">
          <span class="field-label">${label}</span>
          <span class="${cls}">${escHtml(display)}</span>
        </div>`;
    }).join('');

  main.innerHTML = `
    ${badge}
    <div class="fields-card">${rows}</div>
    <div class="actions">
      <button class="btn-add" id="addBtn">Add to HubSpot</button>
    </div>
    <div class="status" id="statusMsg"></div>`;

  document.getElementById('addBtn').addEventListener('click', () => handleAdd(mode, data));
}

function buildRows(mode, data) {
  if (mode === 'company') {
    return [
      { label: 'Name',        value: data.name },
      { label: 'Website',     value: data.website },
      { label: 'LinkedIn URL', value: data.linkedinUrl }
    ];
  }
  return [
    { label: 'First name',  value: data.firstName },
    { label: 'Last name',   value: data.lastName },
    { label: 'Job title',   value: data.jobTitle },
    { label: 'Company',     value: data.company },
    { label: 'Email',       value: data.email },
    { label: 'LinkedIn URL', value: data.linkedinUrl }
  ];
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── HubSpot API calls ────────────────────────────────────────────────────────

async function hsRequest(token, method, path, body) {
  const res = await fetch(`${HS_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res;
}

async function createContact(token, data) {
  const props = {
    firstname: data.firstName || '',
    lastname:  data.lastName  || '',
    hs_linkedin_url: data.linkedinUrl || ''
  };
  if (data.email)    props.email    = data.email;
  if (data.jobTitle) props.jobtitle = data.jobTitle;

  return hsRequest(token, 'POST', '/crm/v3/objects/contacts', { properties: props });
}

async function createCompany(token, data) {
  const props = {
    name: data.name || '',
    linkedin_company_page: data.linkedinUrl || ''
  };
  if (data.website) props.website = data.website;

  return hsRequest(token, 'POST', '/crm/v3/objects/companies', { properties: props });
}

async function searchCompanyByName(token, name) {
  const res = await hsRequest(token, 'POST', '/crm/v3/objects/companies/search', {
    filterGroups: [{
      filters: [{ propertyName: 'name', operator: 'EQ', value: name }]
    }]
  });
  if (!res.ok) return null;
  const json = await res.json();
  return (json.results && json.results.length > 0) ? json.results[0] : null;
}

async function createCompanyByName(token, name) {
  const res = await hsRequest(token, 'POST', '/crm/v3/objects/companies', {
    properties: { name }
  });
  if (!res.ok) return null;
  return res.json();
}

async function associateContactToCompany(token, contactId, companyId) {
  return hsRequest(
    token,
    'PUT',
    `/crm/v4/objects/contacts/${contactId}/associations/companies/${companyId}`,
    [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 279 }]
  );
}

// ── Add flow ─────────────────────────────────────────────────────────────────

async function handleAdd(mode, data) {
  const { token } = await chrome.storage.sync.get('token');
  if (!token) {
    showInfo('Add your HubSpot token in <a id="settingsLink" href="#">Settings</a>.');
    document.getElementById('settingsLink').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  const btn = document.getElementById('addBtn');
  const statusEl = document.getElementById('statusMsg');

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Adding…';
  statusEl.className = 'status';
  statusEl.textContent = '';

  try {
    if (mode === 'company') {
      await addCompany(token, data, btn, statusEl);
    } else {
      await addContact(token, data, btn, statusEl);
    }
  } catch (err) {
    showStatus(statusEl, 'error', `Unexpected error: ${err.message}`);
    resetBtn(btn, mode);
  }
}

async function addCompany(token, data, btn, statusEl) {
  const res = await createCompany(token, data);

  if (res.status === 409) {
    showStatus(statusEl, 'error', 'Already exists in HubSpot.');
    resetBtn(btn, 'company');
    return;
  }
  if (!res.ok) {
    const err = await safeJson(res);
    showStatus(statusEl, 'error', `HubSpot error: ${err.message || res.status}`);
    resetBtn(btn, 'company');
    return;
  }

  showStatus(statusEl, 'success', 'Added to HubSpot ✓');
  btn.style.display = 'none';
}

async function addContact(token, data, btn, statusEl) {
  const res = await createContact(token, data);

  if (res.status === 409) {
    showStatus(statusEl, 'error', 'Already exists in HubSpot.');
    resetBtn(btn, 'contact');
    return;
  }
  if (!res.ok) {
    const err = await safeJson(res);
    showStatus(statusEl, 'error', `HubSpot error: ${err.message || res.status}`);
    resetBtn(btn, 'contact');
    return;
  }

  const contactData = await res.json();
  const contactId = contactData.id;

  // Company association
  if (data.company) {
    let company = await searchCompanyByName(token, data.company);
    if (!company) {
      company = await createCompanyByName(token, data.company);
    }
    if (company && company.id) {
      await associateContactToCompany(token, contactId, company.id);
    }
  }

  showStatus(statusEl, 'success', 'Added to HubSpot ✓');
  btn.style.display = 'none';
}

function showStatus(el, type, msg) {
  el.className = `status ${type}`;
  el.textContent = msg;
}

function resetBtn(btn, mode) {
  btn.disabled = false;
  btn.textContent = 'Add to HubSpot';
}

async function safeJson(res) {
  try { return await res.json(); } catch (_) { return {}; }
}

// ── Initialise ───────────────────────────────────────────────────────────────

async function init() {
  const { token } = await chrome.storage.sync.get('token');

  if (!token) {
    showInfo('Add your HubSpot token in <a id="settingsLink" href="#">Settings</a> to get started.');
    document.getElementById('settingsLink').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_) {}

  if (!tab || !tab.url || !/linkedin\.com\/(in|company)\//i.test(tab.url)) {
    showInfo('Open a LinkedIn company or person profile to use this.');
    return;
  }

  showInfo('<div class="spinner" style="border-color:rgba(0,0,0,.15);border-top-color:#0A66C2;margin:0 auto 8px;"></div>Scanning profile…');

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (err) {
    showInfo(`Could not access this page. Try refreshing it.<br><small>${escHtml(err.message)}</small>`);
    return;
  }

  const data = results && results[0] && results[0].result;

  if (!data || data.mode === 'unknown') {
    showInfo('Open a LinkedIn company or person profile to use this.');
    return;
  }

  renderFields(data.mode, data);
}

init();

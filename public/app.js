// Selectors
const elements = {
  loginOverlay: document.getElementById('login-overlay'),
  loginForm: document.getElementById('login-form'),
  loginPassword: document.getElementById('login-password'),
  loginError: document.getElementById('login-error'),
  
  btnLogout: document.getElementById('btn-logout'),
  serviceStatus: document.getElementById('service-status'),
  statusText: document.querySelector('#service-status .status-text'),
  btnToggle: document.getElementById('btn-toggle'),
  btnClearLogs: document.getElementById('btn-clear-logs'),
  earnedRun: document.getElementById('earned-run'),
  totalToday: document.getElementById('total-today'),
  totalLifetime: document.getElementById('total-lifetime'),
  accountList: document.getElementById('account-list'),
  clientCount: document.getElementById('client-count'),
  clientsTbody: document.getElementById('clients-tbody'),
  logViewport: document.getElementById('log-viewport'),
  
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),
  settingsForm: document.getElementById('settings-form'),
  profilesContainer: document.getElementById('profiles-container'),
  btnAddProfile: document.getElementById('btn-add-profile')
};

// Global State
let authToken = localStorage.getItem('db_auth_token') || '';
let isRunning = false;
let lastLogCount = 0;
let pollInterval = null;
let revenueChartInstance = null;

// Auth Fetch Helper
async function authFetch(url, options = {}) {
  options.headers = options.headers || {};
  if (authToken) {
    options.headers['Authorization'] = `Bearer ${authToken}`;
  }
  options.headers['Content-Type'] = 'application/json';
  
  const res = await fetch(url, options);
  if (res.status === 401) {
    showLoginOverlay();
    throw new Error('Unauthorized');
  }
  return res;
}

// Authentication Views
function showLoginOverlay() {
  elements.loginOverlay.classList.remove('hidden');
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function hideLoginOverlay() {
  elements.loginOverlay.classList.add('hidden');
  elements.loginError.classList.add('hidden');
  elements.loginPassword.value = '';
  
  // Start polling status
  fetchStatus();
  if (!pollInterval) {
    pollInterval = setInterval(fetchStatus, 2000);
  }
}

// Login Submit
elements.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = elements.loginPassword.value;
  elements.loginError.classList.add('hidden');
  
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    
    if (res.ok) {
      authToken = password;
      localStorage.setItem('db_auth_token', password);
      hideLoginOverlay();
    } else {
      elements.loginError.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Login error:', err);
    elements.loginError.textContent = 'Server connection error.';
    elements.loginError.classList.remove('hidden');
  }
});

// Logout Submit
elements.btnLogout.addEventListener('click', () => {
  authToken = '';
  localStorage.removeItem('db_auth_token');
  showLoginOverlay();
});

// Tab Routing
elements.tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tabName = btn.getAttribute('data-tab');
    
    // Toggle active classes on tab buttons
    elements.tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Toggle hidden classes on tab content blocks
    elements.tabContents.forEach(c => c.classList.add('hidden'));
    document.getElementById(`tab-${tabName}-content`).classList.remove('hidden');
    
    // Trigger tab-specific loads
    if (tabName === 'analytics') {
      loadAnalytics();
    } else if (tabName === 'settings') {
      loadSettings();
    }
  });
});

// Fetch Status & Update View
async function fetchStatus() {
  try {
    const res = await authFetch('/api/status');
    const data = await res.json();
    
    updateHeader(data.running);
    updateEarnings(data.totals);
    updateAccounts(data.configProfiles, data.profiles);
    updateClients(data.clients);
    updateLogs(data.logs);
  } catch (err) {
    console.error('Error polling status:', err);
  }
}

function updateHeader(running, textOverride) {
  isRunning = running;
  elements.serviceStatus.className = `status-badge ${running ? 'running' : 'stopped'}`;
  elements.statusText.textContent = textOverride || (running ? 'Running' : 'Stopped');
  
  if (running) {
    elements.btnToggle.textContent = 'Stop Simulator';
    elements.btnToggle.className = 'btn btn-danger';
  } else {
    elements.btnToggle.textContent = 'Start Simulator';
    elements.btnToggle.className = 'btn btn-primary';
  }
}

function updateEarnings(totals) {
  elements.earnedRun.textContent = parseFloat(totals.earnedTodayRun).toFixed(6);
  elements.totalToday.textContent = `$${parseFloat(totals.currentToday).toFixed(2)}`;
  elements.totalLifetime.textContent = `$${parseFloat(totals.currentLifetime).toFixed(2)}`;
}

function updateAccounts(configProfiles, apiProfiles) {
  if (!configProfiles || configProfiles.length === 0) {
    elements.accountList.innerHTML = '<div class="loading-placeholder">No profiles configured.</div>';
    return;
  }

  const apiProfileMap = {};
  apiProfiles.forEach(p => {
    apiProfileMap[p.name] = p;
  });

  elements.accountList.innerHTML = configProfiles.map(p => {
    const apiP = apiProfileMap[p.name];
    const earned = apiP ? `$${apiP.earnedTodayRun.toFixed(6)}` : '$0.000000';
    const total = apiP ? `$${apiP.currentTodayUsd.toFixed(2)}` : '$0.00';
    const blockedStatus = apiP && apiP.blocked ? ' <span class="badge" style="background:var(--accent-rose-glow);color:var(--accent-rose);border-color:var(--accent-rose)">Blocked</span>' : '';

    return `
      <div class="account-item">
        <div class="account-info">
          <span class="account-name">${p.name}${blockedStatus}</span>
          <span class="account-meta">Scale: ${p.scale || 1} clients • ${p.clientId ? 'Fingerprinted' : 'Random ID'}</span>
        </div>
        <div class="account-revenue">
          <span class="acc-earned" title="Earned this run">+${earned}</span>
          <span class="acc-total" title="Lifetime account today">${total} today</span>
        </div>
      </div>
    `;
  }).join('');
}

function updateClients(clients) {
  elements.clientCount.textContent = `${clients.length} Active`;

  if (!clients || clients.length === 0) {
    elements.clientsTbody.innerHTML = `
      <tr>
        <td colspan="6" class="no-data">No active virtual clients running.</td>
      </tr>
    `;
    return;
  }

  elements.clientsTbody.innerHTML = clients.map(c => {
    const statusClass = c.lastStatus === 'Success' || c.lastStatus.includes('Billed')
      ? 'status-success' 
      : (c.lastStatus === 'Stopped' || c.lastStatus.includes('Error') ? 'status-error' : 'status-initial');

    return `
      <tr>
        <td class="c-name">${c.name}</td>
        <td class="c-id" title="${c.clientId}">${c.clientId.slice(0, 12)}...</td>
        <td class="c-ad" title="${c.adTitle || 'None'}">${c.adTitle || 'Waiting for ad...'}</td>
        <td class="c-ticks">${c.ticks}</td>
        <td><span class="c-status ${statusClass}">${c.lastStatus}</span></td>
        <td class="c-seen">${c.lastTickTime || 'Pending'}</td>
      </tr>
    `;
  }).join('');
}

function updateLogs(logs) {
  if (logs.length === lastLogCount) return;
  
  const wasAtBottom = elements.logViewport.scrollHeight - elements.logViewport.clientHeight <= elements.logViewport.scrollTop + 50;
  
  elements.logViewport.innerHTML = logs.map(l => {
    let lineClass = 'log-line';
    if (l.message.includes('SYSTEM:')) lineClass += ' system-line';
    else if (l.message.includes('ERROR:') || l.message.includes('Failed') || l.message.includes('Rate limited')) lineClass += ' error-line';
    
    return `
      <div class="${lineClass}">
        <span class="log-time">[${l.time}]</span>${l.message}
      </div>
    `;
  }).join('');
  
  lastLogCount = logs.length;

  if (wasAtBottom || lastLogCount <= 5) {
    elements.logViewport.scrollTop = elements.logViewport.scrollHeight;
  }
}

// Toggle Simulator Process
elements.btnToggle.addEventListener('click', async () => {
  const endpoint = isRunning ? '/api/stop' : '/api/start';
  elements.btnToggle.disabled = true;
  try {
    const res = await authFetch(endpoint, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      updateHeader(!isRunning);
    }
  } catch (err) {
    console.error('Error toggling simulator:', err);
  } finally {
    elements.btnToggle.disabled = false;
  }
});

// Clear Logs
elements.btnClearLogs.addEventListener('click', async () => {
  try {
    const res = await authFetch('/api/clear-logs', { method: 'POST' });
    if (res.ok) {
      elements.logViewport.innerHTML = '';
      lastLogCount = 0;
    }
  } catch (err) {
    console.error('Error clearing logs:', err);
  }
});

// Analytics (Chart.js)
async function loadAnalytics() {
  try {
    const res = await authFetch('/api/revenue-history');
    const historyData = await res.json();
    renderChart(historyData);
  } catch (err) {
    console.error('Failed to load revenue history:', err);
  }
}

function renderChart(data) {
  const ctx = document.getElementById('revenue-chart').getContext('2d');
  
  if (revenueChartInstance) {
    revenueChartInstance.destroy();
  }
  
  if (!data || data.length === 0) {
    // Render empty state on canvas
    ctx.clearRect(0, 0, 800, 400);
    ctx.font = '14px Inter';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.fillText('No historical revenue data recorded yet.', 400, 200);
    return;
  }
  
  // Format timelines and datasets
  // Group entries by hour or timestamp, showing total accumulated USD per profile
  const profilesMap = {};
  const labelsSet = new Set();
  
  data.forEach(item => {
    const dateStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    labelsSet.add(dateStr);
    
    if (!profilesMap[item.profile_name]) {
      profilesMap[item.profile_name] = [];
    }
    profilesMap[item.profile_name].push({
      label: dateStr,
      value: parseFloat(item.today_usd)
    });
  });
  
  const labels = Array.from(labelsSet);
  const colors = [
    { border: 'rgb(26, 212, 131)', background: 'rgba(26, 212, 131, 0.1)' }, // Emerald
    { border: 'rgb(124, 58, 237)', background: 'rgba(124, 58, 237, 0.1)' }, // Purple
    { border: 'rgb(244, 63, 94)', background: 'rgba(244, 63, 94, 0.1)' }    // Rose
  ];
  
  let colorIdx = 0;
  const datasets = Object.keys(profilesMap).map(profileName => {
    const c = colors[colorIdx % colors.length];
    colorIdx++;
    
    // Align data points with labels timeline
    const pointsMap = {};
    profilesMap[profileName].forEach(pt => {
      pointsMap[pt.label] = pt.value;
    });
    
    const plotData = labels.map(lbl => pointsMap[lbl] !== undefined ? pointsMap[lbl] : null);
    
    return {
      label: profileName,
      data: plotData,
      borderColor: c.border,
      backgroundColor: c.background,
      fill: true,
      tension: 0.3,
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 6
    };
  });
  
  revenueChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#94a3b8',
            font: { family: 'Inter', weight: '500' }
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleColor: '#f8fafc',
          bodyColor: '#e2e8f0',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function(context) {
              return `${context.dataset.label}: $${context.parsed.y.toFixed(4)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: { color: '#64748b', font: { family: 'Inter', size: 10 } }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: {
            color: '#64748b',
            font: { family: 'Inter', size: 10 },
            callback: function(value) {
              return '$' + value.toFixed(2);
            }
          }
        }
      }
    }
  });
}

// Settings Panel (Editor)
async function loadSettings() {
  try {
    const res = await authFetch('/api/config');
    const config = await res.json();
    renderSettingsList(config);
  } catch (err) {
    console.error('Failed to load config profiles:', err);
  }
}

function renderSettingsList(config) {
  elements.profilesContainer.innerHTML = '';
  
  if (!config || config.length === 0) {
    addBlankProfileCard();
    return;
  }
  
  config.forEach(p => {
    addProfileCard(p);
  });
}

function addProfileCard(p = { name: '', clientId: '', refreshToken: '', scale: 1 }) {
  const card = document.createElement('div');
  card.className = 'profile-edit-card';
  card.innerHTML = `
    <div class="profile-card-header">
      <h3>Profile Settings</h3>
      <button type="button" class="btn-delete-profile">Remove</button>
    </div>
    <div class="profile-row-inputs">
      <div class="form-group">
        <label>Profile Name</label>
        <input type="text" class="input-text input-text-sm input-name" placeholder="e.g. primary_acc" value="${p.name || ''}" required>
      </div>
      <div class="form-group">
        <label>Client ID (Fingerprint)</label>
        <input type="text" class="input-text input-text-sm input-client-id" placeholder="Optional (24-char hex)" value="${p.clientId || ''}" maxlength="24">
      </div>
      <div class="form-group">
        <label>Refresh Token</label>
        <input type="text" class="input-text input-text-sm input-refresh-token" placeholder="Bearer refresh token" value="${p.refreshToken || ''}" required>
      </div>
      <div class="form-group">
        <label>Scale (Clients)</label>
        <input type="number" class="input-text input-text-sm input-scale" placeholder="10" value="${p.scale || 1}" min="1" max="50" required>
      </div>
    </div>
  `;
  
  // Attach Delete Listener
  card.querySelector('.btn-delete-profile').addEventListener('click', () => {
    card.remove();
    if (elements.profilesContainer.children.length === 0) {
      addBlankProfileCard();
    }
  });
  
  elements.profilesContainer.appendChild(card);
}

function addBlankProfileCard() {
  addProfileCard({ name: '', clientId: '', refreshToken: '', scale: 10 });
}

// Add Profile button listener
elements.btnAddProfile.addEventListener('click', () => {
  addProfileCard({ name: '', clientId: '', refreshToken: '', scale: 10 });
});

// Settings Form Submit
elements.settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const config = [];
  const cards = elements.profilesContainer.querySelectorAll('.profile-edit-card');
  
  cards.forEach(card => {
    const name = card.querySelector('.input-name').value.trim();
    const clientId = card.querySelector('.input-client-id').value.trim();
    const refreshToken = card.querySelector('.input-refresh-token').value.trim();
    const scale = parseInt(card.querySelector('.input-scale').value, 10) || 1;
    
    if (name && refreshToken) {
      const profile = { name, refreshToken, scale };
      if (clientId) {
        profile.clientId = clientId;
      }
      config.push(profile);
    }
  });
  
  if (config.length === 0) {
    alert('You must configure at least one active profile.');
    return;
  }
  
  const submitButton = elements.settingsForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Saving & Restarting...';
  
  try {
    const res = await authFetch('/api/config', {
      method: 'POST',
      body: JSON.stringify(config)
    });
    
    if (res.ok) {
      alert('Configuration saved successfully. Simulator restarting in background.');
      // Switch back to Dashboard tab
      elements.tabBtns[0].click();
    } else {
      const errData = await res.json();
      alert(`Error saving configuration: ${errData.error || 'Server error'}`);
    }
  } catch (err) {
    console.error('Error saving settings:', err);
    alert('Connection failure when updating configuration.');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Save & Restart Simulator';
  }
});

// Initial boot logic
if (authToken) {
  hideLoginOverlay();
} else {
  showLoginOverlay();
}

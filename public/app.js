const elements = {
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
  logViewport: document.getElementById('log-viewport')
};

let isRunning = false;
let lastLogCount = 0;

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error('Status fetch failed');
    const data = await res.json();
    
    updateHeader(data.running);
    updateEarnings(data.totals);
    updateAccounts(data.configProfiles, data.profiles);
    updateClients(data.clients);
    updateLogs(data.logs);
  } catch (err) {
    console.error('Error polling status:', err);
    updateHeader(false, 'Disconnected');
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
          <span class="acc-total" title="Lifetime account balance">${total} today</span>
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
    const statusClass = c.lastStatus === 'Success' 
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

elements.btnToggle.addEventListener('click', async () => {
  const endpoint = isRunning ? '/api/stop' : '/api/start';
  elements.btnToggle.disabled = true;
  try {
    const res = await fetch(endpoint, { method: 'POST' });
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

elements.btnClearLogs.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/clear-logs', { method: 'POST' });
    if (res.ok) {
      elements.logViewport.innerHTML = '';
      lastLogCount = 0;
    }
  } catch (err) {
    console.error('Error clearing logs:', err);
  }
});

// Poll every 2 seconds for fresh updates
fetchStatus();
setInterval(fetchStatus, 2000);

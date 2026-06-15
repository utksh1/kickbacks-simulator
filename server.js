const express = require('express');
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const { loadConfig } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_PATH = path.join(__dirname, 'config.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let simulatorProcess = null;
let logs = [];
let clients = {};
let profiles = {};

function appendLog(message) {
  const logLine = {
    time: new Date().toLocaleTimeString(),
    message: message.trim()
  };
  logs.push(logLine);
  if (logs.length > 500) logs.shift();
}

function startSimulator() {
  if (simulatorProcess) return false;

  appendLog("SYSTEM: Starting simulator process...");
  
  // Fork simulator.js
  simulatorProcess = fork(path.join(__dirname, 'simulator.js'), [], {
    silent: true // so we can capture stdout/stderr stream
  });

  simulatorProcess.stdout.on('data', (data) => {
    const line = data.toString();
    appendLog(line);
  });

  simulatorProcess.stderr.on('data', (data) => {
    const line = data.toString();
    appendLog(`ERROR: ${line}`);
  });

  simulatorProcess.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'earnings') {
      const { profileName, todayUsd, lifetimeUsd, todayMicros, lifetimeMicros, blocked } = msg;
      
      if (!profiles[profileName]) {
        profiles[profileName] = {
          name: profileName,
          initialTodayUsd: todayUsd,
          initialLifetimeUsd: lifetimeUsd,
          initialTodayMicros: todayMicros,
          initialLifetimeMicros: lifetimeMicros,
          currentTodayUsd: todayUsd,
          currentLifetimeUsd: lifetimeUsd,
          currentTodayMicros: todayMicros,
          currentLifetimeMicros: lifetimeMicros,
          blocked,
          earnedTodayRun: 0,
          earnedLifetimeRun: 0
        };
      } else {
        const prof = profiles[profileName];
        prof.currentTodayUsd = todayUsd;
        prof.currentLifetimeUsd = lifetimeUsd;
        prof.currentTodayMicros = todayMicros;
        prof.currentLifetimeMicros = lifetimeMicros;
        prof.blocked = blocked;
        
        // Calculate earnings this run in USD
        prof.earnedTodayRun = Math.max(0, (todayMicros - prof.initialTodayMicros) / 1000000);
        prof.earnedLifetimeRun = Math.max(0, (lifetimeMicros - prof.initialLifetimeMicros) / 1000000);
      }
    } else if (msg.type === 'client_ad') {
      const { clientName, clientId, adId, adTitle } = msg;
      if (!clients[clientName]) {
        clients[clientName] = {
          name: clientName,
          clientId,
          adTitle,
          adId,
          ticks: 0,
          lastTickTime: null,
          lastStatus: 'Initial'
        };
      } else {
        clients[clientName].adTitle = adTitle;
        clients[clientName].adId = adId;
      }
    } else if (msg.type === 'client_tick') {
      const { clientName, clientId, adId, adTitle, status, visibleMs } = msg;
      if (!clients[clientName]) {
        clients[clientName] = {
          name: clientName,
          clientId,
          adTitle,
          adId,
          ticks: 1,
          lastTickTime: new Date().toLocaleTimeString(),
          lastStatus: status === 200 ? 'Success' : `Error (${status})`
        };
      } else {
        clients[clientName].ticks++;
        clients[clientName].lastTickTime = new Date().toLocaleTimeString();
        clients[clientName].lastStatus = status === 200 ? 'Success' : `Error (${status})`;
        if (adTitle) clients[clientName].adTitle = adTitle;
        if (adId) clients[clientName].adId = adId;
      }
    } else if (msg.type === 'client_billing') {
      const { clientName, status } = msg;
      if (clients[clientName]) {
        clients[clientName].lastStatus = (status === 200 || status === 204) ? 'Billed (Success)' : `Billing Error (${status})`;
      }
    }
  });

  simulatorProcess.on('exit', (code, signal) => {
    appendLog(`SYSTEM: Simulator process exited (code: ${code}, signal: ${signal})`);
    simulatorProcess = null;
    // Keep profiles and clients state, but mark clients as inactive
    Object.keys(clients).forEach(k => {
      clients[k].lastStatus = 'Stopped';
    });
  });

  return true;
}

function stopSimulator() {
  if (!simulatorProcess) return false;
  appendLog("SYSTEM: Stopping simulator process...");
  simulatorProcess.kill('SIGINT');
  return true;
}

// Auto-start simulator on boot
startSimulator();

// API routes
app.get('/api/status', async (req) => {
  let configProfiles = [];
  try {
    configProfiles = await loadConfig();
  } catch (err) {
    // ignore
  }

  // Aggregate totals
  let totalEarnedTodayRun = 0;
  let totalEarnedLifetimeRun = 0;
  let totalCurrentToday = 0;
  let totalCurrentLifetime = 0;

  Object.values(profiles).forEach(p => {
    totalEarnedTodayRun += p.earnedTodayRun;
    totalEarnedLifetimeRun += p.earnedLifetimeRun;
    totalCurrentToday += p.currentTodayUsd;
    totalCurrentLifetime += p.currentLifetimeUsd;
  });

  req.res.json({
    running: simulatorProcess !== null,
    configProfiles,
    profiles: Object.values(profiles),
    clients: Object.values(clients),
    totals: {
      earnedTodayRun: totalEarnedTodayRun.toFixed(6),
      earnedLifetimeRun: totalEarnedLifetimeRun.toFixed(6),
      currentToday: totalCurrentToday.toFixed(2),
      currentLifetime: totalCurrentLifetime.toFixed(2)
    },
    logs
  });
});

app.post('/api/start', (req) => {
  const success = startSimulator();
  req.res.json({ success });
});

app.post('/api/stop', (req) => {
  const success = stopSimulator();
  req.res.json({ success });
});

app.post('/api/clear-logs', (req) => {
  logs = [];
  req.res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Kickbacks Simulator Dashboard is live at http://localhost:${PORT}\n`);
});

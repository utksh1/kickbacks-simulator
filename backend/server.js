require('dotenv').config();
const express = require('express');
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const { 
  loadConfig, 
  saveRevenueHistory, 
  getRevenueHistory,
  getClientStats,
  updateClientTick,
  updateClientAd,
  updateClientBilling,
  distributeClientRevenue,
  clearLocalClientStats
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'Ankitsin';

// OpenAPI 3.0 Document Specification
const openApiSpec = {
  openapi: "3.0.0",
  info: {
    title: "Kickbacks API",
    version: "1.0.0"
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer"
      }
    }
  },
  security: [
    {
      BearerAuth: []
    }
  ],
  paths: {
    "/": {
      get: {
        summary: "Check backend status",
        security: [],
        responses: {
          200: {
            description: "Success"
          }
        }
      }
    },
    "/api/login": {
      post: {
        summary: "Verify dashboard password",
        security: [],
        responses: {
          200: {
            description: "Success"
          }
        }
      }
    },
    "/api/status": {
      get: {
        summary: "Retrieve aggregated simulator state",
        responses: {
          200: {
            description: "Success"
          }
        }
      }
    },
    "/api/start": {
      post: {
        summary: "Start simulator process",
        responses: {
          200: {
            description: "Success"
          }
        }
      }
    },
    "/api/stop": {
      post: {
        summary: "Stop simulator process",
        responses: {
          200: {
            description: "Success"
          }
        }
      }
    },
    "/api/clear-logs": {
      post: {
        summary: "Clear backend logs buffer",
        responses: {
          200: {
            description: "Success"
          }
        }
      }
    },
    "/api/config": {
      get: {
        summary: "Get configuration JSON profiles list",
        responses: {
          200: {
            description: "Success"
          }
        }
      },
      post: {
        summary: "Save configuration JSON profiles list",
        responses: {
          200: {
            description: "Success"
          }
        }
      }
    },
    "/api/revenue-history": {
      get: {
        summary: "Get revenue history snapshots",
        responses: {
          200: {
            description: "Success"
          }
        }
      }
    }
  }
};

// Authentication Middleware
function checkAuth(req, res, next) {
  if (!DASHBOARD_PASSWORD) {
    return next();
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.substring(7);
  if (token !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.use(express.json());

// Global CORS Middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Production Security Headers
app.use((req, res, next) => {
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  next();
});

let simulatorProcess = null;
let logs = [];
let profiles = {};
let billedClients = []; // In-memory queue to attribute actual revenue

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

  clearLocalClientStats(process.env.INSTANCE_NAME || 'default');
  appendLog("SYSTEM: Starting simulator process...");
  
  // Fork simulator.js located in the same directory
  simulatorProcess = fork(path.join(__dirname, 'simulator.js'), [], {
    silent: true // Capture stdout/stderr stream
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
      
      const lastTodayMicros = profiles[profileName]?.currentTodayMicros;
      const lastLifetimeMicros = profiles[profileName]?.currentLifetimeMicros;

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
        
        prof.earnedTodayRun = Math.max(0, (todayMicros - prof.initialTodayMicros) / 1000000);
        prof.earnedLifetimeRun = Math.max(0, (lifetimeMicros - prof.initialLifetimeMicros) / 1000000);
      }

      // Attribute actual revenue diff to clients with micro-dollar precision
      const microsDiff = (lastLifetimeMicros !== undefined && lifetimeMicros > lastLifetimeMicros)
        ? (lifetimeMicros - lastLifetimeMicros)
        : ((lastTodayMicros !== undefined && todayMicros > lastTodayMicros) ? (todayMicros - lastTodayMicros) : 0);

      if (microsDiff > 0) {
        const diff = microsDiff / 1000000;
        if (billedClients.length > 0) {
          distributeClientRevenue(billedClients, diff).catch(err => {
            console.error("SYSTEM: Error distributing revenue to billed clients:", err.message);
          });
          billedClients = [];
        } else {
          // Fallback: distribute to all active clients of this instance
          getClientStats(process.env.INSTANCE_NAME || 'default').then(dbClients => {
            const activeNames = dbClients
              .filter(c => c.instance_name === (process.env.INSTANCE_NAME || 'default') && c.last_status !== 'Stopped')
              .map(c => c.client_name);
            if (activeNames.length > 0) {
              distributeClientRevenue(activeNames, diff).catch(err => {
                console.error("SYSTEM: Error distributing revenue to fallback active clients:", err.message);
              });
            }
          });
        }
      }

      const nowTime = Date.now();
      const prof = profiles[profileName];
      if (prof && (!prof.lastLoggedDbTime || (nowTime - prof.lastLoggedDbTime >= 15 * 60 * 1000))) {
        prof.lastLoggedDbTime = nowTime;
        saveRevenueHistory(profileName, todayUsd, lifetimeUsd).catch(err => {
          console.error("SYSTEM: Error logging revenue history snapshot:", err.message);
        });
      }
    } else if (msg.type === 'client_ad') {
      const { clientName, clientId, adId, adTitle } = msg;
      updateClientAd(clientName, process.env.INSTANCE_NAME || 'default', clientId, adId, adTitle, 'Success').catch(err => {
        console.error("SYSTEM: Error updating client ad in DB:", err.message);
      });
    } else if (msg.type === 'client_tick') {
      const { clientName, clientId, adId, adTitle, status } = msg;
      const lastTickTime = new Date().toLocaleTimeString();
      let statusStr = 'Success';
      if (typeof status === 'string') {
        statusStr = status;
      } else if (status === 200 || status === 204) {
        statusStr = 'Success';
      } else if (status) {
        statusStr = `HTTP Error (${status})`;
      }
      updateClientTick(clientName, process.env.INSTANCE_NAME || 'default', clientId, adId, adTitle, statusStr, lastTickTime).catch(err => {
        console.error("SYSTEM: Error updating client tick in DB:", err.message);
      });
    } else if (msg.type === 'client_billing') {
      const { clientName, status } = msg;
      const isSuccess = (status === 200 || status === 204);
      const statusStr = isSuccess ? 'Billed (Success)' : `Billing Error (${status})`;
      
      updateClientBilling(clientName, statusStr, isSuccess).catch(err => {
        console.error("SYSTEM: Error updating client billing in DB:", err.message);
      });

      if (isSuccess) {
        if (!billedClients.includes(clientName)) {
          billedClients.push(clientName);
        }
      }
    }
  });

  simulatorProcess.on('exit', (code, signal) => {
    appendLog(`SYSTEM: Simulator process exited (code: ${code}, signal: ${signal})`);
    simulatorProcess = null;
    
    // Reset client statuses in DB
    const { runPgQuery } = require('./db');
    runPgQuery(
      "UPDATE client_stats SET last_status = 'Stopped', updated_at = NOW() WHERE instance_name = $1;",
      [process.env.INSTANCE_NAME || 'default']
    ).catch(err => {
      console.error("SYSTEM: Error updating exit statuses in DB:", err.message);
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

// Auto-start is handled after DB/config initialization in app.listen


// Reset this instance's clients in DB to Stopped on boot in case of crash
loadConfig().then(() => {
  const { runPgQuery } = require('./db');
  runPgQuery(
    "UPDATE client_stats SET last_status = 'Stopped', updated_at = NOW() WHERE instance_name = $1;",
    [process.env.INSTANCE_NAME || 'default']
  ).catch(err => {
    // Ignore error
  });
});

// Health/Status API Check at root
app.get('/', (req, res) => {
  res.json({
    status: "online",
    message: "Kickbacks Simulator Backend API is running. Central dashboard is hosted on Vercel.",
    instanceName: process.env.INSTANCE_NAME || 'default',
    running: simulatorProcess !== null
  });
});

// Swagger UI Docs handler (CDN backed)
app.get(['/docs', '/dos'], (req, res) => {
  const specJsonStr = JSON.stringify(openApiSpec);
  const swaggerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      const ui = SwaggerUIBundle({
        spec: ${specJsonStr},
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout"
      });
      window.ui = ui;
    };
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(swaggerHtml);
});

// Authentication checks
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === DASHBOARD_PASSWORD) {
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'Invalid password' });
});

app.get('/api/status', checkAuth, async (req, res) => {
  let configProfiles = [];
  try {
    configProfiles = await loadConfig();
  } catch (err) {
    // Ignore error
  }

  let dbClients = [];
  try {
    dbClients = await getClientStats(process.env.INSTANCE_NAME || 'default');
  } catch (err) {
    console.error("SYSTEM: Failed to load client stats from DB:", err.message);
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

  res.json({
    running: simulatorProcess !== null,
    instanceName: process.env.INSTANCE_NAME || 'default',
    configProfiles,
    profiles: Object.values(profiles),
    clients: dbClients.map(c => ({
      name: c.client_name,
      instanceName: c.instance_name,
      clientId: c.client_id,
      adTitle: c.ad_title,
      adId: c.ad_id,
      ticks: c.ticks,
      billing_count: c.billing_count,
      revenue_usd: c.revenue_usd,
      lastStatus: c.last_status,
      lastTickTime: c.last_tick_time,
      updatedAt: c.updated_at
    })),
    totals: {
      earnedTodayRun: totalEarnedTodayRun.toFixed(6),
      earnedLifetimeRun: totalEarnedLifetimeRun.toFixed(6),
      currentToday: totalCurrentToday.toFixed(2),
      currentLifetime: totalCurrentLifetime.toFixed(2)
    },
    logs
  });
});

app.post('/api/start', checkAuth, (req, res) => {
  const success = startSimulator();
  res.json({ success });
});

app.post('/api/stop', checkAuth, (req, res) => {
  const success = stopSimulator();
  res.json({ success });
});

app.post('/api/clear-logs', checkAuth, (req, res) => {
  logs = [];
  res.json({ success: true });
});

app.get('/api/config', checkAuth, async (req, res) => {
  try {
    const config = await loadConfig();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/config', checkAuth, async (req, res) => {
  try {
    const newConfig = req.body;
    if (!Array.isArray(newConfig)) {
      return res.status(400).json({ error: 'Config must be an array' });
    }
    const { saveConfig } = require('./db');
    await saveConfig(newConfig);
    
    // Automatically restart simulator to apply config changes
    appendLog("SYSTEM: Configuration updated via settings panel. Restarting simulator...");
    stopSimulator();
    setTimeout(() => {
      startSimulator();
    }, 1000);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/revenue-history', checkAuth, async (req, res) => {
  try {
    const history = await getRevenueHistory(24);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Production Error Handlers
process.on('uncaughtException', (err) => {
  console.error('SYSTEM: Uncaught Exception:', err.stack || err);
  appendLog(`ERROR: Uncaught Exception: ${err.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('SYSTEM: Unhandled Rejection:', reason);
  appendLog(`ERROR: Unhandled Rejection: ${reason}`);
});

// Graceful Shutdown Handler
function gracefulShutdown(signal) {
  console.log(`\nSYSTEM: Received ${signal}. Starting graceful shutdown...`);
  appendLog(`SYSTEM: Received ${signal}. Stopping server...`);
  
  if (simulatorProcess) {
    console.log('SYSTEM: Stopping simulator subprocess...');
    simulatorProcess.kill('SIGINT');
  }
  
  setTimeout(() => {
    console.log('SYSTEM: Shutdown complete.');
    process.exit(0);
  }, 1000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

app.listen(PORT, async () => {
  console.log(`\n🚀 Kickbacks Simulator Backend is live at http://localhost:${PORT}\n`);

  // Auto-start simulator on boot if config has accounts
  try {
    const config = await loadConfig();
    if (Array.isArray(config) && config.length > 0) {
      console.log(`SYSTEM: Auto-starting simulator with ${config.length} account(s)...`);
      startSimulator();
    } else {
      console.log('SYSTEM: No accounts configured. Use POST /api/start to begin.');
    }
  } catch (err) {
    console.error('SYSTEM: Auto-start check failed:', err.message);
  }
});

require('dotenv').config();
const express = require('express');
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const { loadConfig, saveRevenueHistory, getRevenueHistory } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'Ankitsin';

// OpenAPI 3.0 Document Specification
const openApiSpec = {
  openapi: "3.0.0",
  info: {
    title: "Kickbacks Simulator Backend API",
    version: "1.0.0",
    description: "Headless API endpoints for managing the Kickbacks virtual client simulator."
  },
  servers: [
    {
      url: "/",
      description: "Local or relative base URL"
    }
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Enter your dashboard password (e.g. Ankitsin)"
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
        description: "Returns online status, message, active instance name, and simulator running state.",
        security: [],
        responses: {
          200: {
            description: "Backend status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "online" },
                    message: { type: "string", example: "Kickbacks Simulator Backend API is running." },
                    instanceName: { type: "string", example: "instance_1" },
                    running: { type: "boolean", example: true }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/login": {
      post: {
        summary: "Verify dashboard password",
        description: "Validates credentials for authorization checks.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  password: { type: "string", example: "Ankitsin" }
                },
                required: ["password"]
              }
            }
          }
        },
        responses: {
          200: {
            description: "Login successful",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true }
                  }
                }
              }
            }
          },
          401: {
            description: "Invalid password",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "Invalid password" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/status": {
      get: {
        summary: "Retrieve aggregated simulator state",
        description: "Returns active configuration, running virtual clients list, revenue metrics, and logs.",
        responses: {
          200: {
            description: "Simulator state summary",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    running: { type: "boolean" },
                    instanceName: { type: "string" },
                    configProfiles: { type: "array" },
                    profiles: { type: "array" },
                    clients: { type: "array" },
                    totals: {
                      type: "object",
                      properties: {
                        earnedTodayRun: { type: "string" },
                        earnedLifetimeRun: { type: "string" },
                        currentToday: { type: "string" },
                        currentLifetime: { type: "string" }
                      }
                    },
                    logs: { type: "array" }
                  }
                }
              }
            }
          },
          401: {
            description: "Unauthorized"
          }
        }
      }
    },
    "/api/start": {
      post: {
        summary: "Start simulator process",
        description: "Boots up the background virtual client emulator subprocess.",
        responses: {
          200: {
            description: "Execution response",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" }
                  }
                }
              }
            }
          },
          401: {
            description: "Unauthorized"
          }
        }
      }
    },
    "/api/stop": {
      post: {
        summary: "Stop simulator process",
        description: "Gracefully kills the active virtual client emulator subprocess.",
        responses: {
          200: {
            description: "Termination response",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" }
                  }
                }
              }
            }
          },
          401: {
            description: "Unauthorized"
          }
        }
      }
    },
    "/api/clear-logs": {
      post: {
        summary: "Clear backend logs logs buffer",
        description: "Resets the stored logs array inside the Express process memory.",
        responses: {
          200: {
            description: "Logs cleared",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true }
                  }
                }
              }
            }
          },
          401: {
            description: "Unauthorized"
          }
        }
      }
    },
    "/api/config": {
      get: {
        summary: "Get configuration JSON profiles list",
        description: "Retrieves client profiles list from PostgreSQL database.",
        responses: {
          200: {
            description: "Configuration profiles list",
            content: {
              "application/json": {
                schema: {
                  type: "array"
                }
              }
            }
          },
          401: {
            description: "Unauthorized"
          }
        }
      },
      post: {
        summary: "Save configuration JSON profiles list",
        description: "Saves client profiles to PostgreSQL database and triggers a simulator restart.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "array"
              }
            }
          }
        },
        responses: {
          200: {
            description: "Configuration saved successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true }
                  }
                }
              }
            }
          },
          401: {
            description: "Unauthorized"
          }
        }
      }
    },
    "/api/revenue-history": {
      get: {
        summary: "Get revenue history snapshots",
        description: "Fetches past 24 hourly revenue snapshots logged in PostgreSQL.",
        responses: {
          200: {
            description: "History records array",
            content: {
              "application/json": {
                schema: {
                  type: "array"
                }
              }
            }
          },
          401: {
            description: "Unauthorized"
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
      const { clientName, clientId, adId, adTitle, status } = msg;
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
app.get('/api-docs', (req, res) => {
  const specJsonStr = JSON.stringify(openApiSpec);
  const swaggerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Kickbacks Simulator API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; overflow: -webkit-scrollbars; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #0f172a; }
    /* Beautiful Dark Mode overlay style */
    .swagger-ui {
      filter: invert(90%) hue-rotate(180deg);
      background-color: #fafafa;
      padding: 30px;
      max-width: 1200px;
      margin: 0 auto;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info { margin: 20px 0; }
    .swagger-ui input[type="text"], .swagger-ui select {
      background: #eaeaea !important;
    }
  </style>
</head>
<body>
  <div style="padding: 20px; text-align: center;">
    <h1 style="color: #f8fafc; font-family: sans-serif; font-size: 26px; margin: 0 0 10px 0;">KICKBACKS SIMULATOR API PLAYGROUND</h1>
    <p style="color: #94a3b8; font-family: sans-serif; margin: 0;">Interactive OpenAPI 3.0 Documentation</p>
  </div>
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
        layout: "BaseLayout"
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

app.listen(PORT, () => {
  console.log(`\n🚀 Kickbacks Simulator Backend is live at http://localhost:${PORT}\n`);
});

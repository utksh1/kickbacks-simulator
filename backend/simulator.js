require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadConfig, saveConfig } = require('./db');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const BACKEND_BASE = "https://kickbacks-backend-gmdaqm2c7q-uw.a.run.app";
const CC_VERSION = "0.3.177";
const EXT_VERSION = "0.3.177";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class TokenManager {
  constructor(profile, index, config) {
    this.profile = profile;
    this.index = index;
    this.config = config;
    this.accessToken = null;
    this.refreshPromise = null;
  }

  async getAccessToken() {
    if (this.accessToken) return this.accessToken;
    return this.refresh();
  }

  async refresh(retries = 3, delay = 5000) {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        console.log(`[Auth:${this.profile.name}] Refreshing access token (Attempt ${attempt}/${retries})...`);
        try {
          const res = await fetch(`${BACKEND_BASE}/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refresh_token: this.profile.refreshToken })
          });

          if (res.status === 429) {
            console.warn(`[Auth:${this.profile.name}] Rate limited (429). Retrying in ${delay / 1000}s...`);
            await sleep(delay);
            delay *= 2; // Exponential backoff
            continue;
          }

          if (!res.ok) {
            console.error(`[Auth:${this.profile.name}] Failed to refresh token. Status: ${res.status}`);
            return null;
          }

          const body = await res.json();
          if (!body.access_token) {
            console.error(`[Auth:${this.profile.name}] Response missing access_token`);
            return null;
          }

          this.accessToken = body.access_token;
          if (body.refresh_token && body.refresh_token !== this.profile.refreshToken) {
            console.log(`[Auth:${this.profile.name}] Refresh token rotated. Saving config...`);
            this.profile.refreshToken = body.refresh_token;
            this.config[this.index] = this.profile;
            await saveConfig(this.config);
          }
          return this.accessToken;
        } catch (err) {
          console.error(`[Auth:${this.profile.name}] Network error on attempt ${attempt}:`, err.message);
          if (attempt < retries) {
            await sleep(delay);
            delay *= 2;
          }
        }
      }
      return null;
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  invalidateToken() {
    this.accessToken = null;
  }

  async getEarnings() {
    let token = await this.getAccessToken();
    if (!token) return null;

    try {
      const res = await fetch(`${BACKEND_BASE}/v1/earnings`, {
        headers: { 'authorization': `Bearer ${token}` }
      });

      if (res.status === 401 || res.status === 403) {
        this.invalidateToken();
        token = await this.refresh();
        if (token) return this.getEarnings();
        return null;
      }

      if (!res.ok) {
        console.error(`[Auth:${this.profile.name}] Failed to fetch earnings. Status: ${res.status}`);
        return null;
      }

      const body = await res.json();
      return {
        lifetimeUsd: parseFloat(body.lifetime_usd || "0"),
        todayUsd: parseFloat(body.today_usd || "0"),
        lifetimeMicros: body.lifetime_micros || 0,
        todayMicros: body.today_micros || 0,
        blocked: body.blocked || false
      };
    } catch (err) {
      console.error(`[Auth:${this.profile.name}] Error fetching earnings:`, err.message);
      return null;
    }
  }
}

async function runVirtualClient(name, clientId, authManager) {
  console.log(`[${name}] Initializing client (clientId: ${clientId})...`);
  
  let activeAd = null;
  let viewTickTimer = null;
  let rotationTimer = null;
  let accruedVisibleMs = 0;
  let lastAccrualMs = 0;
  let corr = "";

  async function fetchPortfolio() {
    let token = await authManager.getAccessToken();
    if (!token) return null;

    try {
      const res = await fetch(`${BACKEND_BASE}/v1/portfolio?claude_code_version=${encodeURIComponent(CC_VERSION)}`, {
        headers: { 'authorization': `Bearer ${token}` }
      });

      if (res.status === 401 || res.status === 403) {
        console.log(`[${name}] Received auth rejection. Invalidating token & retrying...`);
        authManager.invalidateToken();
        token = await authManager.refresh();
        if (token) return fetchPortfolio();
        return null;
      }

      if (!res.ok) {
        console.error(`[${name}] Failed to fetch portfolio. Status: ${res.status}`);
        return null;
      }

      const body = await res.json();
      const ads = body.ads || [];
      const rotationIntervalMs = body.rotation_interval_seconds ? (body.rotation_interval_seconds * 1000) : 120000;
      const viewThresholdMs = body.view_threshold_seconds ? (body.view_threshold_seconds * 1000) : 15000;
      
      return {
        ad: ads[0] || null,
        rotationIntervalMs,
        viewThresholdMs
      };
    } catch (err) {
      console.error(`[${name}] Network error fetching portfolio:`, err.message);
      return null;
    }
  }

  async function sendMetric(eventType, ad, params = {}) {
    let token = await authManager.getAccessToken();
    if (!token) return null;

    const eventUuid = crypto.randomUUID();
    const body = {
      event_type: eventType,
      ad_id: ad.ad_id,
      campaign_id: ad.campaign_id,
      client_id: clientId,
      ts: new Date().toISOString(),
      claude_code_version: CC_VERSION,
      extension_version: EXT_VERSION,
      nonce: eventUuid,
      session_token: ad.session_token || ""
    };

    if (params.surface) body.surface = params.surface;
    if (typeof params.visibleMs === 'number') body.visible_ms = params.visibleMs;

    const headers = {
      'content-type': 'application/json',
      'authorization': `Bearer ${token}`
    };

    if (params.corr) {
      headers['X-Kickbacks-Corr'] = params.corr;
      headers['X-Vibe-Corr'] = params.corr;
    }

    try {
      const res = await fetch(`${BACKEND_BASE}/v1/metrics`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        console.warn(`[${name}] Metric ${eventType} returned HTTP status: ${res.status}`);
        if (res.status === 401 || res.status === 403) {
          authManager.invalidateToken();
        }
      } else {
        console.log(`[${name}] Metric ${eventType} sent successfully (status: ${res.status})`);
      }
      return res.status;
    } catch (err) {
      console.error(`[${name}] Network error sending metric ${eventType}:`, err.message);
      return null;
    }
  }

  function endShow() {
    if (viewTickTimer) {
      clearInterval(viewTickTimer);
      viewTickTimer = null;
    }
    console.log(`[${name}] Stopped showing ad. Total visible ms: ${accruedVisibleMs}`);
    accruedVisibleMs = 0;
    lastAccrualMs = 0;
  }

  async function startShow(ad, viewThresholdMs = 15000) {
    endShow();
    if (!ad) {
      console.log(`[${name}] No active ad returned in portfolio.`);
      return;
    }

    console.log(`[${name}] Active ad: "${ad.title_text}" (ID: ${ad.ad_id}) (Threshold: ${viewThresholdMs}ms)`);
    
    if (process.send) {
      process.send({
        type: 'client_ad',
        clientName: name,
        clientId: clientId,
        adId: ad.ad_id,
        adTitle: ad.title_text
      });
    }

    // Statusline impression
    const cliCorr = "cli." + ad.ad_id;
    await sendMetric("impression_rendered", ad, { corr: cliCorr, surface: "statusline" });
    await sendMetric("impression_viewable", ad, { corr: cliCorr, surface: "statusline" });

    // Spinner impression
    const spinnerCorr = "spinner." + ad.ad_id;
    await sendMetric("impression_rendered", ad, { corr: spinnerCorr, surface: "spinner" });
    await sendMetric("impression_viewable", ad, { corr: spinnerCorr, surface: "spinner" });

    accruedVisibleMs = 0;
    lastAccrualMs = Date.now();
    corr = "clitick." + ad.ad_id + "." + Math.random().toString(36).slice(2, 8);
    let thresholdMetSent = false;

    viewTickTimer = setInterval(async () => {
      const now = Date.now();
      const delta = now - lastAccrualMs;
      if (delta > 0) accruedVisibleMs += Math.min(delta, 5000);
      lastAccrualMs = now;

      console.log(`[${name}] Tick: Crediting view (${accruedVisibleMs}ms)...`);
      const status = await sendMetric("view_tick", ad, {
        corr,
        surface: "statusline",
        visibleMs: accruedVisibleMs
      });

      if (process.send) {
        process.send({
          type: 'client_tick',
          clientName: name,
          clientId: clientId,
          adId: ad.ad_id,
          adTitle: ad.title_text,
          status: status,
          visibleMs: accruedVisibleMs
        });
      }

      // Send billing metric if threshold met
      if (!thresholdMetSent && accruedVisibleMs >= viewThresholdMs) {
        thresholdMetSent = true;
        console.log(`[${name}] View threshold met! Sending billing metric (view_threshold_met)...`);
        
        const billingStatus = await sendMetric("view_threshold_met", ad, {
          corr,
          surface: "statusline",
          visibleMs: accruedVisibleMs,
          viewable: true,
          viewPct: 100,
          viewMs: accruedVisibleMs
        });

        if (process.send) {
          process.send({
            type: 'client_billing',
            clientName: name,
            clientId: clientId,
            adId: ad.ad_id,
            status: billingStatus
          });
        }
      }
    }, 5000);
  }

  async function rotateAd() {
    const portfolio = await fetchPortfolio();
    if (portfolio) {
      activeAd = portfolio.ad;
      await startShow(activeAd, portfolio.viewThresholdMs);
      if (rotationTimer) clearTimeout(rotationTimer);
      rotationTimer = setTimeout(rotateAd, portfolio.rotationIntervalMs);
    } else {
      if (rotationTimer) clearTimeout(rotationTimer);
      rotationTimer = setTimeout(rotateAd, 30000);
    }
  }

  await rotateAd();
}

async function start() {
  const config = await loadConfig();
  
  const activeProfiles = config.map((p, idx) => ({ p, idx })).filter(item => 
    item.p.refreshToken &&
    item.p.refreshToken !== "insert_another_account_refresh_token_here"
  );

  if (activeProfiles.length === 0) {
    console.error("No active profiles configured in config.json.");
    process.exit(1);
  }

  console.log("Starting scaled multi-client simulator with staggered starts...");

  activeProfiles.forEach(({ p, idx }) => {
    const authManager = new TokenManager(p, idx, config);
    const scaleFactor = p.scale || 1;
    console.log(`[Profile:${p.name}] Spawning ${scaleFactor} virtual clients...`);

    // Poll earnings per profile
    const pollEarnings = async () => {
      const earnings = await authManager.getEarnings();
      if (earnings) {
        console.log(`[Profile:${p.name}] Real Earnings: $${earnings.todayUsd} today · $${earnings.lifetimeUsd} lifetime (micros: ${earnings.todayMicros})`);
        if (process.send) {
          process.send({
            type: 'earnings',
            profileName: p.name,
            todayUsd: earnings.todayUsd,
            lifetimeUsd: earnings.lifetimeUsd,
            todayMicros: earnings.todayMicros,
            lifetimeMicros: earnings.lifetimeMicros,
            blocked: earnings.blocked
          });
        }
      }
    };

    pollEarnings();
    const earningsInterval = setInterval(pollEarnings, 15000);

    let startIdx = 0;
    let endIdx = scaleFactor;
    const instanceMatch = process.env.INSTANCE_NAME?.match(/instance_(\d+)/);
    if (instanceMatch) {
      const idx = parseInt(instanceMatch[1], 10);
      const totalInstances = 6;
      const sliceSize = Math.floor(scaleFactor / totalInstances);
      startIdx = (idx - 1) * sliceSize;
      endIdx = idx * sliceSize;
    }

    console.log(`[Profile:${p.name}] Spawning client indices ${startIdx} to ${endIdx - 1} (${endIdx - startIdx} clients total)...`);

    for (let c = startIdx; c < endIdx; c++) {
      const virtualClientId = c === 0 && p.clientId 
        ? p.clientId 
        : crypto.randomBytes(12).toString("hex");

      const virtualName = `${p.name}_v${c + 1}`;
      // Stagger each virtual client start by a small random offset (0‑2000 ms)
      const startDelay = Math.floor(Math.random() * 2000);
      setTimeout(() => {
        runVirtualClient(virtualName, virtualClientId, authManager).catch(err => {
          console.error(`Fatal error in virtual client ${virtualName}:`, err);
        });
      }, startDelay);
    }
  });
}

// Exception handlers
process.on('uncaughtException', (err) => {
  console.error('[Simulator] Uncaught Exception:', err.stack || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Simulator] Unhandled Rejection:', reason);
});

// Graceful Shutdown
function handleShutdown(signal) {
  console.log(`\n[Simulator] Received ${signal}. Stopping virtual clients...`);
  process.exit(0);
}
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

start();

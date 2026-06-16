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

// Distributed lock key for PG advisory lock (same across all instances)
const REFRESH_LOCK_KEY = 999777;

class TokenManager {
  constructor(profile, index, config) {
    this.profile = profile;
    this.index = index;
    this.config = config;
    this.accessToken = profile.accessToken || null;
    this.refreshInFlight = null;
    // Circuit breaker: tracks consecutive hard-401 failures on refresh
    this.consecutiveRefreshFailures = 0;
    this.circuitBreakerBackoffMs = 30000; // starts at 30s, doubles each failure
    this.circuitBreakerUntil = 0; // timestamp until which we should NOT attempt refresh
    this.preemptiveTimer = null;
    this.tokenAgeMs = 0;
  }

  startPreemptiveRefresh() {
    if (this.preemptiveTimer) clearInterval(this.preemptiveTimer);
    this.preemptiveTimer = setInterval(() => {
      this.tokenAgeMs += 60000;
      // Kickbacks tokens last ~60 minutes. Refresh preemptively at 50 minutes.
      if (this.tokenAgeMs >= 50 * 60 * 1000) {
        console.log(`[Auth:${this.profile.name}] Preemptive refresh triggered (token is 50+ mins old).`);
        this.refresh().catch(err => console.error(`[Auth:${this.profile.name}] Preemptive refresh failed:`, err.message));
      }
    }, 60000);
  }

  async getAccessToken() {
    try {
      const latestConfig = await loadConfig();
      const currentProfile = latestConfig[this.index];
      if (currentProfile && currentProfile.accessToken) {
        if (this.accessToken !== currentProfile.accessToken) {
          this.accessToken = currentProfile.accessToken;
          this.profile.refreshToken = currentProfile.refreshToken;
          this.profile.accessToken = currentProfile.accessToken;
          this.tokenAgeMs = 0; // Reset age since we got a new token from DB
        }
        // If we got a valid token from DB, reset circuit breaker
        if (this.consecutiveRefreshFailures > 0) {
          console.log(`[Auth:${this.profile.name}] Got fresh token from DB. Resetting circuit breaker.`);
          this.consecutiveRefreshFailures = 0;
          this.circuitBreakerBackoffMs = 30000;
          this.circuitBreakerUntil = 0;
        }
      }
    } catch (err) {
      console.warn(`[Auth:${this.profile.name}] Failed to load latest config from DB inside getAccessToken:`, err.message);
    }

    if (this.accessToken) return this.accessToken;
    return this.refresh();
  }

  async refresh(retries = 3, delay = 5000) {
    // Circuit breaker: if we've failed too many times, don't even try
    if (this.circuitBreakerUntil > Date.now()) {
      const waitSec = Math.round((this.circuitBreakerUntil - Date.now()) / 1000);
      console.warn(`[Auth:${this.profile.name}] Circuit breaker OPEN. Refresh token appears dead. Waiting ${waitSec}s before next attempt. Re-run 'node mint.js' to get a new token.`);
      return null;
    }

    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      // Step 1: Check if another instance already refreshed
      try {
        const latestConfig = await loadConfig();
        const currentProfile = latestConfig[this.index];
        if (currentProfile && currentProfile.accessToken && currentProfile.refreshToken !== this.profile.refreshToken) {
          console.log(`[Auth:${this.profile.name}] Another instance already refreshed. Using updated token.`);
          this.accessToken = currentProfile.accessToken;
          this.profile.refreshToken = currentProfile.refreshToken;
          this.profile.accessToken = currentProfile.accessToken;
          this.consecutiveRefreshFailures = 0;
          this.circuitBreakerBackoffMs = 30000;
          this.circuitBreakerUntil = 0;
          this.tokenAgeMs = 0;
          return this.accessToken;
        }
        // Even if refresh token is the same, maybe access token was updated
        if (currentProfile && currentProfile.accessToken) {
          this.accessToken = currentProfile.accessToken;
          this.profile.accessToken = currentProfile.accessToken;
          this.profile.refreshToken = currentProfile.refreshToken;
          return this.accessToken;
        }
      } catch (err) {
        console.warn(`[Auth:${this.profile.name}] DB check failed inside refresh:`, err.message);
      }

      // Step 2: Try to acquire PG advisory lock for distributed refresh
      const { getPgClient } = require('./db');
      let pgClient = null;
      let gotLock = false;
      try {
        pgClient = await getPgClient();
        const lockRes = await pgClient.query('SELECT pg_try_advisory_lock($1) as locked;', [REFRESH_LOCK_KEY]);
        gotLock = lockRes.rows[0]?.locked === true;
      } catch (err) {
        console.warn(`[Auth:${this.profile.name}] Could not acquire PG advisory lock:`, err.message);
        // Fall through — if DB is down, attempt refresh anyway
        gotLock = true;
      }

      if (!gotLock) {
        // Another instance holds the lock — wait for it to finish, then read the result
        console.log(`[Auth:${this.profile.name}] Another instance is refreshing. Waiting for lock release...`);
        if (pgClient) { pgClient.release(); pgClient = null; }
        for (let wait = 0; wait < 6; wait++) {
          await sleep(3000);
          try {
            const latestConfig = await loadConfig();
            const currentProfile = latestConfig[this.index];
            if (currentProfile && currentProfile.accessToken && currentProfile.refreshToken !== this.profile.refreshToken) {
              this.accessToken = currentProfile.accessToken;
              this.profile.refreshToken = currentProfile.refreshToken;
              this.profile.accessToken = currentProfile.accessToken;
              console.log(`[Auth:${this.profile.name}] Got refreshed token from DB (written by another instance).`);
              this.consecutiveRefreshFailures = 0;
              this.circuitBreakerBackoffMs = 30000;
              this.circuitBreakerUntil = 0;
              this.tokenAgeMs = 0;
              return this.accessToken;
            }
          } catch (err) {
            // keep waiting
          }
        }
        console.warn(`[Auth:${this.profile.name}] Timed out waiting for lock holder. Will attempt refresh ourselves.`);
      }

      // Step 3: We have the lock (or timed out waiting). Actually refresh.
      let refreshResult = null;
      try {
        refreshResult = await this._doRefresh(retries, delay);
      } finally {
        // Release the advisory lock
        if (gotLock && pgClient) {
          try {
            await pgClient.query('SELECT pg_advisory_unlock($1);', [REFRESH_LOCK_KEY]);
          } catch (err) {
            // Ignore unlock errors
          }
          pgClient.release();
        } else if (pgClient) {
          pgClient.release();
        }
      }
      return refreshResult;
    })();

    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  async _doRefresh(retries = 3, delay = 5000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      // Re-check DB before each attempt (another instance may have finished)
      try {
        const latestConfig = await loadConfig();
        const currentProfile = latestConfig[this.index];
        if (currentProfile && currentProfile.accessToken && currentProfile.refreshToken !== this.profile.refreshToken) {
          console.log(`[Auth:${this.profile.name}] Token was refreshed by another instance between attempts. Using it.`);
          this.accessToken = currentProfile.accessToken;
          this.profile.refreshToken = currentProfile.refreshToken;
          this.profile.accessToken = currentProfile.accessToken;
          this.consecutiveRefreshFailures = 0;
          this.circuitBreakerBackoffMs = 30000;
          this.circuitBreakerUntil = 0;
          this.tokenAgeMs = 0;
          return this.accessToken;
        }
        // Sync refresh token from DB in case it changed
        if (currentProfile && currentProfile.refreshToken) {
          this.profile.refreshToken = currentProfile.refreshToken;
        }
      } catch (err) {
        console.warn(`[Auth:${this.profile.name}] DB re-check failed:`, err.message);
      }

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
          delay *= 2;
          continue;
        }

        if (res.status === 401) {
          console.error(`[Auth:${this.profile.name}] Refresh token REJECTED (401). Token is dead.`);
          this.consecutiveRefreshFailures++;
          if (this.consecutiveRefreshFailures >= 3) {
            // Trip the circuit breaker — stop trying for a while
            this.circuitBreakerUntil = Date.now() + this.circuitBreakerBackoffMs;
            console.error(`[Auth:${this.profile.name}] ⚠️  CIRCUIT BREAKER TRIPPED after ${this.consecutiveRefreshFailures} consecutive failures. Pausing refresh for ${this.circuitBreakerBackoffMs / 1000}s. Run 'node mint.js' to get a new token.`);
            this.circuitBreakerBackoffMs = Math.min(this.circuitBreakerBackoffMs * 2, 600000); // max 10 min
          }
          return null;
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
        const newRefreshToken = body.refresh_token || this.profile.refreshToken;

        console.log(`[Auth:${this.profile.name}] ✅ Token refreshed successfully. Saving to DB...`);
        this.profile.refreshToken = newRefreshToken;
        this.profile.accessToken = this.accessToken;

        // Reset circuit breaker and age on success
        this.consecutiveRefreshFailures = 0;
        this.circuitBreakerBackoffMs = 30000;
        this.circuitBreakerUntil = 0;
        this.tokenAgeMs = 0;

        // CRITICAL: This save MUST succeed. The old refresh token is already
        // consumed by the API. If we fail to persist the new one, all instances
        // are permanently locked out until a manual re-mint.
        let saved = false;
        for (let saveAttempt = 1; saveAttempt <= 3; saveAttempt++) {
          try {
            const latestConfig = await loadConfig();
            latestConfig[this.index] = this.profile;
            await saveConfig(latestConfig);
            saved = true;
            console.log(`[Auth:${this.profile.name}] ✅ New token saved to DB (attempt ${saveAttempt}).`);
            break;
          } catch (dbErr) {
            console.error(`[Auth:${this.profile.name}] ⚠️  CRITICAL: DB save failed (attempt ${saveAttempt}/3):`, dbErr.message);
            if (saveAttempt < 3) await sleep(2000 * saveAttempt);
          }
        }
        if (!saved) {
          console.error(`[Auth:${this.profile.name}] 🚨 CRITICAL: All DB save attempts failed! New refresh token may be lost. Token in memory: ${newRefreshToken.substring(0, 10)}...`);
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
  }

  invalidateToken() {
    if (this.accessToken) {
      console.log(`[Auth:${this.profile.name}] Invalidating access token (will refresh on next use).`);
    }
    this.accessToken = null;
    this.profile.accessToken = null;
    // Also clear from DB so other instances don't keep using the dead token
    loadConfig().then(config => {
      if (config[this.index]) {
        config[this.index].accessToken = null;
        saveConfig(config).catch(() => {});
      }
    }).catch(() => {});
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
          // Invalidate and REFRESH — don't just invalidate and hope
          authManager.invalidateToken();
          const newToken = await authManager.refresh();
          if (newToken) {
            // Retry once with the fresh token
            try {
              headers['authorization'] = `Bearer ${newToken}`;
              const retryRes = await fetch(`${BACKEND_BASE}/v1/metrics`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body)
              });
              if (retryRes.ok) {
                console.log(`[${name}] Metric ${eventType} retry succeeded (status: ${retryRes.status})`);
              }
              return retryRes.status;
            } catch (retryErr) {
              console.error(`[${name}] Metric ${eventType} retry failed:`, retryErr.message);
              return null;
            }
          }
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
    authManager.startPreemptiveRefresh();
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

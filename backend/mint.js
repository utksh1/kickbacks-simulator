const crypto = require('crypto');

const BACKEND_BASE = "https://kickbacks-backend-gmdaqm2c7q-uw.a.run.app";
const clientId = crypto.randomBytes(12).toString("hex");

async function mint() {
  console.log("1. Starting login session...");
  // Manual redirect handling is required so we don't automatically follow to Google Accounts HTML page.
  const startRes = await fetch(`${BACKEND_BASE}/v1/auth/extension/start?client_id=${clientId}`, {
    redirect: 'manual'
  });
  
  const loginUrl = startRes.headers.get('location');
  if (!loginUrl) {
    console.error("Failed to retrieve redirect URL from headers");
    process.exit(1);
  }

  const urlObj = new URL(loginUrl);
  const state = urlObj.searchParams.get("state");
  if (!state) {
    console.error("Failed to parse state from redirect URL");
    process.exit(1);
  }

  console.log(`\n👉 OPEN THIS LINK IN YOUR BROWSER AND SIGN IN:\n\n${loginUrl}\n`);
  console.log("Waiting for authorization (polling every 3s)...");

  const interval = setInterval(async () => {
    try {
      const pollRes = await fetch(`${BACKEND_BASE}/v1/auth/extension/poll?state=${encodeURIComponent(state)}&client_id=${clientId}`);
      if (pollRes.status === 200) {
        const credentials = await pollRes.json();
        clearInterval(interval);
        
        console.log("\n🎉 Authorization Successful!");
        console.log("-----------------------------------------");
        console.log(`Name: client_${clientId.slice(0, 6)}`);
        console.log(`clientId: ${clientId}`);
        console.log(`refreshToken: ${credentials.refresh_token}`);
        console.log("-----------------------------------------");

        // 1. Auto-accept Terms of Service & Boosted Mode
        try {
          await fetch(`${BACKEND_BASE}/v1/me/consent`, {
            method: "POST",
            headers: { "authorization": `Bearer ${credentials.access_token}`, "content-type": "application/json" },
            body: JSON.stringify({ tos_accepted_version: "2026-03-01", accepted: true })
          });
          await fetch(`${BACKEND_BASE}/v1/me/consent/scopes`, {
            method: "POST",
            headers: { "authorization": `Bearer ${credentials.access_token}`, "content-type": "application/json" },
            body: JSON.stringify({
              scopes: { kickbacks_consent: true, boosted_ack: true },
              boosted_ack: { accepted: true, version: "v2-scopes-3" }
            })
          });
          console.log(`✅ TOS & Boosted Consent Auto-Accepted.`);
        } catch (e) {
          console.log(`⚠️ Consent setup error: ${e.message}`);
        }

        // 2. Auto-append to config.json and PostgreSQL
        try {
          const { loadConfig, saveConfig } = require('./db');
          const currentConfig = await loadConfig();
          const accountName = `account_${currentConfig.length + 1}_${clientId.slice(0, 6)}`;
          
          const newAccount = {
            name: accountName,
            clientId: clientId,
            refreshToken: credentials.refresh_token,
            scale: 100,
            accessToken: credentials.access_token
          };

          currentConfig.push(newAccount);
          await saveConfig(currentConfig);

          console.log(`\n🚀 Account successfully saved to config.json and database!`);
          console.log(`Total Active Accounts in Fleet: ${currentConfig.length}`);
          console.log(`Run ./start.sh or restart cluster to distribute clients across all ${currentConfig.length} accounts.\n`);
        } catch (saveErr) {
          console.error("Failed to auto-save config:", saveErr.message);
        }

        process.exit(0);
      } else if (pollRes.status !== 202) {
        console.log(`Polling status: ${pollRes.status}. Retrying...`);
      }
    } catch (err) {
      // Ignore network blips
    }
  }, 3000);
}

mint();

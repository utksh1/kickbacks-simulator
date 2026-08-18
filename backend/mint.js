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

        // Auto-accept Terms of Service so earnings are credited
        try {
          const tosRes = await fetch(`${BACKEND_BASE}/v1/me/consent`, {
            method: "POST",
            headers: { "authorization": `Bearer ${credentials.access_token}`, "content-type": "application/json" }
          });
          if (tosRes.ok) {
            const tosData = await tosRes.json();
            console.log(`✅ TOS Accepted (version: ${tosData.tos_version}, telemetry: ${tosData.telemetry_opt_in})`);
          } else {
            console.log(`⚠️ TOS acceptance returned ${tosRes.status} — accept manually via the extension.`);
          }
        } catch (e) {
          console.log(`⚠️ TOS acceptance failed: ${e.message}`);
        }

        console.log("Copy the values above and paste them into config.json.");
      } else if (pollRes.status !== 202) {
        console.log(`Polling status: ${pollRes.status}. Retrying...`);
      }
    } catch (err) {
      // Ignore network blips
    }
  }, 3000);
}

mint();

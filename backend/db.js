const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const INSTANCE_NAME = process.env.INSTANCE_NAME || 'default';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const { Pool } = require('pg');

let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5, // Small pool size per instance to stay safely below Render free Postgres connection limit
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  pool.on('error', (err) => {
    console.error('DATABASE: Unexpected error on idle client', err.message);
  });
}

async function runPgQuery(query, params = [], retries = 3, delay = 1000) {
  if (!pool) {
    throw new Error("PostgreSQL pool is not initialized (DATABASE_URL missing).");
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await pool.query(query, params);
      return res;
    } catch (err) {
      console.error(`DATABASE: PostgreSQL query error (Attempt ${attempt}/${retries}):`, err.message);
      if (attempt === retries) {
        throw err;
      }
      await sleep(delay);
      delay *= 2; // Exponential backoff
    }
  }
}

async function getPgClient() {
  if (!pool) throw new Error("PostgreSQL pool is not initialized.");
  return await pool.connect();
}

async function loadConfig() {
  if (process.env.DATABASE_URL) {
    try {
      // Create tables if not exist
      await runPgQuery('CREATE TABLE IF NOT EXISTS kickbacks_config (id VARCHAR(50) PRIMARY KEY, data JSONB);');
      await runPgQuery('CREATE TABLE IF NOT EXISTS revenue_history (timestamp TIMESTAMPTZ DEFAULT NOW(), profile_name VARCHAR(100), today_usd NUMERIC(10, 6), lifetime_usd NUMERIC(10, 6));');
      
      // Migrate/Create client_stats table
      await runPgQuery(`
        CREATE TABLE IF NOT EXISTS client_stats (
          client_name VARCHAR(100) PRIMARY KEY,
          instance_name VARCHAR(50),
          client_id VARCHAR(50),
          ad_title VARCHAR(255),
          ad_id VARCHAR(100),
          ticks INTEGER DEFAULT 0,
          billing_count INTEGER DEFAULT 0,
          revenue_usd NUMERIC(10, 6) DEFAULT 0,
          last_status VARCHAR(50),
          last_tick_time VARCHAR(50),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      // Migration: Add instance_name column to revenue_history if it doesn't exist
      await runPgQuery('ALTER TABLE revenue_history ADD COLUMN IF NOT EXISTS instance_name VARCHAR(50) DEFAULT \'default\';');
      
      const res = await runPgQuery('SELECT data FROM kickbacks_config WHERE id = $1;', ['default']);
      if (res.rows && res.rows.length > 0) {
        console.log(`SYSTEM: Config loaded from Render PostgreSQL (using default row for unified token rotation).`);
        return res.rows[0].data;
      }

      // If database is empty, check for INITIAL_CONFIG env var to self-seed
      if (process.env.INITIAL_CONFIG) {
        try {
          const initialData = JSON.parse(process.env.INITIAL_CONFIG);
          if (Array.isArray(initialData) && initialData.length > 0) {
            console.log(`SYSTEM: Postgres empty. Self-seeding with INITIAL_CONFIG...`);
            await runPgQuery('INSERT INTO kickbacks_config (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data;', ['default', JSON.stringify(initialData)]);
            return initialData;
          }
        } catch (parseErr) {
          console.error("SYSTEM: Error parsing INITIAL_CONFIG:", parseErr.message);
        }
      }
    } catch (err) {
      console.error("SYSTEM: Render PostgreSQL load error (falling back to config.json):", err.message);
    }
  }

  // Fallback: Local config.json
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (err) {
    console.error("SYSTEM: Local config load failed:", err.message);
  }
  return [];
}

async function saveConfig(config) {
  if (process.env.DATABASE_URL) {
    try {
      await runPgQuery('CREATE TABLE IF NOT EXISTS kickbacks_config (id VARCHAR(50) PRIMARY KEY, data JSONB);');
      await runPgQuery('INSERT INTO kickbacks_config (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data;', ['default', JSON.stringify(config)]);
      console.log(`SYSTEM: Config saved to Render PostgreSQL (unified default row).`);
    } catch (err) {
      console.error("SYSTEM: Render PostgreSQL save error:", err.message);
    }
  }

  // Fallback: Local config.json
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    console.log("SYSTEM: Config saved to local config.json fallback.");
  } catch (err) {
    console.error("SYSTEM: Local config save failed:", err.message);
  }
}

async function saveRevenueHistory(profileName, todayUsd, lifetimeUsd) {
  if (process.env.DATABASE_URL) {
    try {
      // Get the sum of client revenue for this instance
      const clientRes = await runPgQuery(
        'SELECT COALESCE(SUM(revenue_usd), 0) as total FROM client_stats WHERE instance_name = $1;',
        [INSTANCE_NAME]
      );
      const instanceRevenue = parseFloat(clientRes.rows[0]?.total || 0);

      await runPgQuery(
        'INSERT INTO revenue_history (instance_name, profile_name, today_usd, lifetime_usd) VALUES ($1, $2, $3, $4);',
        [INSTANCE_NAME, profileName, instanceRevenue, instanceRevenue]
      );
      console.log(`SYSTEM: Saved revenue snapshot for instance ${INSTANCE_NAME} ($${instanceRevenue}) (profile: ${profileName}).`);
      
      // Auto-prune data older than 5 days
      await runPgQuery("DELETE FROM revenue_history WHERE timestamp < NOW() - INTERVAL '5 days';");
      await runPgQuery("DELETE FROM client_stats WHERE updated_at < NOW() - INTERVAL '5 days';");
      console.log("SYSTEM: Pruned records older than 5 days from DB.");
    } catch (err) {
      console.error("SYSTEM: Render PostgreSQL saveRevenueHistory error:", err.message);
    }
  }
}

async function getRevenueHistory(limitHours = 24) {
  if (process.env.DATABASE_URL) {
    try {
      const res = await runPgQuery(
        `SELECT timestamp, profile_name, today_usd, lifetime_usd 
         FROM revenue_history 
         WHERE instance_name = $1 AND timestamp >= NOW() - $2 * INTERVAL '1 hour' 
         ORDER BY timestamp ASC;`,
        [INSTANCE_NAME, limitHours]
      );
      return res.rows || [];
    } catch (err) {
      console.error("SYSTEM: Render PostgreSQL getRevenueHistory error:", err.message);
      return [];
    }
  }
  return [];
}

async function getClientStats(instanceName = 'default') {
  if (process.env.DATABASE_URL) {
    try {
      const res = await runPgQuery(
        'SELECT * FROM client_stats WHERE instance_name = $1 ORDER BY client_name ASC;',
        [instanceName]
      );
      return res.rows || [];
    } catch (err) {
      console.error("SYSTEM: getClientStats error:", err.message);
      return [];
    }
  }
  return [];
}

async function updateClientTick(clientName, instanceName, clientId, adId, adTitle, status, lastTickTime) {
  if (process.env.DATABASE_URL) {
    try {
      const query = `
        INSERT INTO client_stats (client_name, instance_name, client_id, ad_id, ad_title, ticks, last_status, last_tick_time, updated_at)
        VALUES ($1, $2, $3, $4, $5, 1, $6, $7, NOW())
        ON CONFLICT (client_name) DO UPDATE SET
          instance_name = EXCLUDED.instance_name,
          client_id = EXCLUDED.client_id,
          ad_id = EXCLUDED.ad_id,
          ad_title = EXCLUDED.ad_title,
          ticks = client_stats.ticks + 1,
          last_status = EXCLUDED.last_status,
          last_tick_time = EXCLUDED.last_tick_time,
          updated_at = NOW();
      `;
      await runPgQuery(query, [clientName, instanceName, clientId, adId, adTitle, status, lastTickTime]);
    } catch (err) {
      console.error("SYSTEM: updateClientTick DB error:", err.message);
    }
  }
}

async function updateClientAd(clientName, instanceName, clientId, adId, adTitle, status) {
  if (process.env.DATABASE_URL) {
    try {
      const query = `
        INSERT INTO client_stats (client_name, instance_name, client_id, ad_id, ad_title, ticks, last_status, updated_at)
        VALUES ($1, $2, $3, $4, $5, 0, $6, NOW())
        ON CONFLICT (client_name) DO UPDATE SET
          instance_name = EXCLUDED.instance_name,
          client_id = EXCLUDED.client_id,
          ad_id = EXCLUDED.ad_id,
          ad_title = EXCLUDED.ad_title,
          last_status = CASE 
            WHEN client_stats.last_status = 'Stopped' OR client_stats.last_status = 'inactive' OR client_stats.last_status IS NULL THEN EXCLUDED.last_status
            ELSE client_stats.last_status
          END,
          updated_at = NOW();
      `;
      await runPgQuery(query, [clientName, instanceName, clientId, adId, adTitle, status]);
    } catch (err) {
      console.error("SYSTEM: updateClientAd DB error:", err.message);
    }
  }
}

async function updateClientBilling(clientName, status, isSuccess) {
  if (process.env.DATABASE_URL) {
    try {
      const incrementBilling = isSuccess ? 1 : 0;
      const query = `
        INSERT INTO client_stats (client_name, billing_count, last_status, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (client_name) DO UPDATE SET
          billing_count = client_stats.billing_count + $2,
          last_status = EXCLUDED.last_status,
          updated_at = NOW();
      `;
      await runPgQuery(query, [clientName, incrementBilling, status]);
    } catch (err) {
      console.error("SYSTEM: updateClientBilling DB error:", err.message);
    }
  }
}

async function distributeClientRevenue(clientNames, amountUsd) {
  if (process.env.DATABASE_URL && clientNames.length > 0 && amountUsd > 0) {
    try {
      const share = amountUsd / clientNames.length;
      const query = `
        UPDATE client_stats 
        SET revenue_usd = revenue_usd + $1, updated_at = NOW()
        WHERE client_name = ANY($2);
      `;
      await runPgQuery(query, [share, clientNames]);
      console.log(`SYSTEM: Distributed $${amountUsd} revenue to clients:`, clientNames);
    } catch (err) {
      console.error("SYSTEM: distributeClientRevenue DB error:", err.message);
    }
  }
}

module.exports = { 
  loadConfig, 
  saveConfig, 
  saveRevenueHistory, 
  getRevenueHistory,
  getClientStats,
  updateClientTick,
  updateClientAd,
  updateClientBilling,
  distributeClientRevenue,
  runPgQuery,
  getPgClient
};

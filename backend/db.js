const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const INSTANCE_NAME = process.env.INSTANCE_NAME || 'default';

async function runPgQuery(query, params = []) {
  const { Client } = require('pg');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for Render PostgreSQL connections
  });
  await client.connect();
  try {
    const res = await client.query(query, params);
    return res;
  } finally {
    await client.end();
  }
}

async function loadConfig() {
  if (process.env.DATABASE_URL) {
    try {
      // Create tables if not exist
      await runPgQuery('CREATE TABLE IF NOT EXISTS kickbacks_config (id VARCHAR(50) PRIMARY KEY, data JSONB);');
      await runPgQuery('CREATE TABLE IF NOT EXISTS revenue_history (timestamp TIMESTAMPTZ DEFAULT NOW(), profile_name VARCHAR(100), today_usd NUMERIC(10, 6), lifetime_usd NUMERIC(10, 6));');
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
      await runPgQuery(
        'INSERT INTO revenue_history (instance_name, profile_name, today_usd, lifetime_usd) VALUES ($1, $2, $3, $4);',
        [INSTANCE_NAME, profileName, todayUsd, lifetimeUsd]
      );
      console.log(`SYSTEM: Saved revenue snapshot for ${profileName} ($${todayUsd}) under instance ${INSTANCE_NAME}.`);
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

module.exports = { loadConfig, saveConfig, saveRevenueHistory, getRevenueHistory };

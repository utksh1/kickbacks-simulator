const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

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
  // Option A: Render PostgreSQL (DATABASE_URL)
  if (process.env.DATABASE_URL) {
    try {
      // Create tables if not exist
      await runPgQuery('CREATE TABLE IF NOT EXISTS kickbacks_config (id VARCHAR(50) PRIMARY KEY, data JSONB);');
      await runPgQuery('CREATE TABLE IF NOT EXISTS revenue_history (timestamp TIMESTAMPTZ DEFAULT NOW(), profile_name VARCHAR(100), today_usd NUMERIC(10, 6), lifetime_usd NUMERIC(10, 6));');
      const res = await runPgQuery('SELECT data FROM kickbacks_config WHERE id = $1;', ['default']);
      if (res.rows && res.rows.length > 0) {
        console.log("SYSTEM: Config loaded from Render PostgreSQL.");
        return res.rows[0].data;
      }

      // If database is empty, check for INITIAL_CONFIG env var to self-seed
      if (process.env.INITIAL_CONFIG) {
        try {
          const initialData = JSON.parse(process.env.INITIAL_CONFIG);
          if (Array.isArray(initialData) && initialData.length > 0) {
            console.log("SYSTEM: Postgres empty. Self-seeding with INITIAL_CONFIG...");
            await runPgQuery('INSERT INTO kickbacks_config (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data;', ['default', JSON.stringify(initialData)]);
            return initialData;
          }
        } catch (parseErr) {
          console.error("SYSTEM: Error parsing INITIAL_CONFIG:", parseErr.message);
        }
      }
    } catch (err) {
      console.error("SYSTEM: Render PostgreSQL load error (falling back):", err.message);
    }
  }

  // Option B: MongoDB Atlas
  if (process.env.MONGODB_URI) {
    try {
      const { MongoClient } = require('mongodb');
      const client = new MongoClient(process.env.MONGODB_URI);
      await client.connect();
      const db = client.db('kickbacks');
      const col = db.collection('config');
      const doc = await col.findOne({ _id: 'default' });
      await client.close();
      if (doc && doc.data) {
        console.log("SYSTEM: Config loaded from MongoDB Atlas.");
        return doc.data;
      }
    } catch (err) {
      console.error("SYSTEM: MongoDB load error (falling back):", err.message);
    }
  }

  // Option C: Supabase REST API
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      const url = `${process.env.SUPABASE_URL}/rest/v1/kickbacks_config?id=eq.default`;
      const res = await fetch(url, {
        headers: {
          'apikey': process.env.SUPABASE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_KEY}`
        }
      });
      if (res.ok) {
        const rows = await res.json();
        if (rows && rows.length > 0) {
          console.log("SYSTEM: Config loaded from Supabase.");
          return typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
        }
      } else {
        console.error("SYSTEM: Supabase load failed. Status:", res.status);
      }
    } catch (err) {
      console.error("SYSTEM: Supabase load error (falling back):", err.message);
    }
  }

  // Fallback: Local config.json
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error("SYSTEM: Local config load failed:", err.message);
    return [];
  }
}

async function saveConfig(config) {
  // Option A: Render PostgreSQL (DATABASE_URL)
  if (process.env.DATABASE_URL) {
    try {
      await runPgQuery('CREATE TABLE IF NOT EXISTS kickbacks_config (id VARCHAR(50) PRIMARY KEY, data JSONB);');
      await runPgQuery('INSERT INTO kickbacks_config (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data;', ['default', JSON.stringify(config)]);
      console.log("SYSTEM: Config saved to Render PostgreSQL.");
      return;
    } catch (err) {
      console.error("SYSTEM: Render PostgreSQL save error:", err.message);
    }
  }

  // Option B: MongoDB Atlas
  if (process.env.MONGODB_URI) {
    try {
      const { MongoClient } = require('mongodb');
      const client = new MongoClient(process.env.MONGODB_URI);
      await client.connect();
      const db = client.db('kickbacks');
      const col = db.collection('config');
      await col.updateOne(
        { _id: 'default' },
        { $set: { data: config } },
        { upsert: true }
      );
      await client.close();
      console.log("SYSTEM: Config saved to MongoDB Atlas.");
      return;
    } catch (err) {
      console.error("SYSTEM: MongoDB save error:", err.message);
    }
  }

  // Option C: Supabase REST API
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      const url = `${process.env.SUPABASE_URL}/rest/v1/kickbacks_config`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': process.env.SUPABASE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({ id: 'default', data: config })
      });
      if (res.ok) {
        console.log("SYSTEM: Config saved to Supabase.");
        return;
      } else {
        const patchUrl = `${process.env.SUPABASE_URL}/rest/v1/kickbacks_config?id=eq.default`;
        const patchRes = await fetch(patchUrl, {
          method: 'PATCH',
          headers: {
            'apikey': process.env.SUPABASE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ data: config })
        });
        if (patchRes.ok) {
          console.log("SYSTEM: Config updated in Supabase.");
          return;
        }
        console.error("SYSTEM: Supabase save/update failed. Status:", res.status, patchRes.status);
      }
    } catch (err) {
      console.error("SYSTEM: Supabase save error:", err.message);
    }
  }

  // Fallback: Local config.json
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    console.log("SYSTEM: Config saved to local config.json.");
  } catch (err) {
    console.error("SYSTEM: Local config save failed:", err.message);
  }
}

async function saveRevenueHistory(profileName, todayUsd, lifetimeUsd) {
  if (process.env.DATABASE_URL) {
    try {
      await runPgQuery(
        'INSERT INTO revenue_history (profile_name, today_usd, lifetime_usd) VALUES ($1, $2, $3);',
        [profileName, todayUsd, lifetimeUsd]
      );
      console.log(`SYSTEM: Saved revenue snapshot for ${profileName} ($${todayUsd}).`);
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
         WHERE timestamp >= NOW() - $1 * INTERVAL '1 hour' 
         ORDER BY timestamp ASC;`,
        [limitHours]
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

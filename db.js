const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

async function loadConfig() {
  // Option A: MongoDB Atlas
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

  // Option B: Supabase REST API
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
  // Option A: MongoDB Atlas
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

  // Option B: Supabase REST API
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      const url = `${process.env.SUPABASE_URL}/rest/v1/kickbacks_config`;
      // Use POST upsert
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
        // Fallback to update / PATCH if POST upsert fails or requires resolution
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

module.exports = { loadConfig, saveConfig };

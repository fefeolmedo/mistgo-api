const express = require('express');
const app = express();

const PORT = process.env.PORT || 8080;

// --- DB wiring (uses Azure App Setting: DATABASE_URL) ---
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // required for Azure Postgres over TLS
});

// health (app)
app.get('/health', (_, res) => res.json({ ok: "ci-cd-test My Dad Is Gay" }));

// health (db)
app.get('/db-ping', async (_, res) => {
  try {
    const r = await pool.query('select 1 as ok');
    res.json({ db: r.rows[0].ok === 1 });
  } catch (e) {
    console.error('DB error:', e.message);
    res.status(500).json({ db: false, error: e.message });
  }
});

app.listen(PORT, () => console.log('API on :' + PORT));
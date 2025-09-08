const express = require('express');
const app = express();

const PORT = process.env.PORT || 8080;

// --- middleware ---
app.use(express.json()); // parse JSON bodies
const cors = require('cors');
app.use(cors()); // allow calls from your frontend (relax this later if needed)

// --- DB wiring ---
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- crypto & tokens ---
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'; // set in Azure later

// --------- routes ---------

// app health
app.get('/health', (_, res) => res.json({ ok: "ci-cd-test" }));

// db health
app.get('/db-ping', async (_, res) => {
  try {
    const r = await pool.query('select 1 as ok');
    res.json({ db: r.rows[0].ok === 1 });
  } catch (e) {
    console.error('DB error:', e.message);
    res.status(500).json({ db: false, error: e.message });
  }
});

// REGISTER: requires username, email, password
app.post('/register', async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Missing username, email, or password' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users(username, email, password_hash) VALUES($1,$2,$3)',
      [username, email, hash]
    );
    return res.status(201).json({ success: true });
  } catch (e) {
    if (e.code === '23505') {
      const msg = (e.detail || '').includes('username') ? 'Username already taken'
                : (e.detail || '').includes('email')    ? 'Email already registered'
                : 'Duplicate value';
      return res.status(409).json({ error: msg });
    }
    console.error('Register error:', e.message);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

// LOGIN: accept identifier via username OR email
app.post('/login', async (req, res) => {
  const { username, email, identifier, password } = req.body || {};
  const id = identifier || username || email;
  if (!id || !password) return res.status(400).json({ error: 'Missing username/email or password' });

  try {
    const looksEmail = id.includes('@');
    const sql = looksEmail
      ? 'SELECT id, username, email, password_hash FROM users WHERE email=$1'
      : 'SELECT id, username, email, password_hash FROM users WHERE username=$1';

    const r = await pool.query(sql, [id]);
    if (r.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = r.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    return res.json({ token, username: user.username, email: user.email });
  } catch (e) {
    console.error('Login error:', e.message);
    return res.status(500).json({ error: 'Login failed' });
  }
});

app.listen(PORT, () => console.log('API on :' + PORT));
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

// register
app.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });

  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users(email, password_hash) VALUES($1, $2)',
      [email, hash]
    );
    return res.status(201).json({ success: true });
  } catch (e) {
    // duplicate email protection (Postgres unique constraint)
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    console.error('Register error:', e.message);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

// login
app.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });

  try {
    const r = await pool.query('SELECT id, email, password_hash FROM users WHERE email=$1', [email]);
    if (r.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = r.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
    return res.json({ token });
  } catch (e) {
    console.error('Login error:', e.message);
    return res.status(500).json({ error: 'Login failed' });
  }
});

app.listen(PORT, () => console.log('API on :' + PORT));
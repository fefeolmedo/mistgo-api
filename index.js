const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

const app = express();

// middleware (order matters)
app.use(express.json());
app.use(cors({
  origin: [
    'https://yellow-plant-08497501e.2.azurestaticapps.net',
    'http://localhost:5500'
  ]
}));

// db
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// health
app.get('/health', (_, res) => res.json({ ok: 'ci-cd-test' }));
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
  console.log('REGISTER BODY:', req.body);
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) 
    return res.status(400).json({ error: 'Missing username, email, or password' });

  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users(username, email, password_hash) VALUES($1,$2,$3)',
      [username.trim(), email.toLowerCase().trim(), hash]
    );
    res.status(201).json({ success: true });
  } catch (e) {
    if (e.code === '23505') {
      const d = (e.detail || '').toLowerCase();
      return res.status(409).json({ error: d.includes('username') ? 'Username already taken' : 'Email already registered' });
    }
    console.error('Register error:', e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// login (username or email)
app.post('/login', async (req, res) => {
  const { username, email, identifier, password } = req.body || {};
  const id = (identifier || username || email || '').trim();
  if (!id || !password) return res.status(400).json({ error: 'Missing username/email or password' });

  try {
    const looksEmail = id.includes('@');
    const sql = `SELECT id, username, email, password_hash FROM users WHERE ${looksEmail ? 'email' : 'username'}=$1`;
    const r = await pool.query(sql, [looksEmail ? id.toLowerCase() : id]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = r.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, username: user.username, email: user.email });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});
// ---- auth helper (reads Bearer token, optional) ----
function getUserIdFromReq(req) {
  try {
    const h = req.headers.authorization || "";
    const t = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!t) return null;
    const p = jwt.verify(t, JWT_SECRET);
    return p.id; // from /login token payload
  } catch { return null; }
}

// ---- simple auth middleware (require a valid JWT) ----
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, username, email }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Create item
app.post('/items', requireAuth, async (req, res) => {
  const { name, description = '', price, quantity } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  // coerce to numbers with sane defaults
  const p = Number.isFinite(+price) ? Number(price) : 0;
  const q = Number.isFinite(+quantity) ? parseInt(quantity, 10) : 0;

  try {
    const r = await pool.query(
      `INSERT INTO items (name, description, price, quantity, owner_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, price, quantity,
                 to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS createdAt`,
      [name, description, p, q, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error('Create item error:', e.message);
    res.status(500).json({ error: 'Failed to create item' });
  }
});

// List (current user’s items)
app.get('/items', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
  `SELECT id, name, description, price, quantity,
          to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
     FROM items
    WHERE id=$1 AND owner_id=$2`,
  [req.params.id, req.user.id]
);
    res.json(r.rows);
  } catch (e) {
    console.error('List items error:', e.message);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// Get by id
app.get('/items/:id', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, description, owner_id, created_at
       FROM items WHERE id=$1 AND owner_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error('Get item error:', e.message);
    res.status(500).json({ error: 'Failed to fetch item' });
  }
});

// Update
app.put('/items/:id', requireAuth, async (req, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const r = await pool.query(
  `UPDATE items
      SET name=$1, description=$2
    WHERE id=$3 AND owner_id=$4
    RETURNING id, name, description, price, quantity,
              to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at`,
  [name, description || null, req.params.id, req.user.id]
);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) {
    console.error('Update item error:', e.message);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// Delete
app.delete('/items/:id', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM items WHERE id=$1 AND owner_id=$2 RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error('Delete item error:', e.message);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

app.listen(PORT, () => console.log('API on :' + PORT));


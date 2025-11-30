const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 10000;
const JWT_SECRET = 'super_secret_goodcord_key';

app.use(cors());
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./goodcord.db', (err) => {
  if (err) console.error('DB error:', err);
  else console.log('SQLite DB connected');
});

// Create tables if not exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester TEXT,
    requested TEXT,
    status TEXT DEFAULT 'pending',
    UNIQUE(requester, requested)
  )`);

  // Group chats
  db.run(`CREATE TABLE IF NOT EXISTS groupchats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    owner TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER,
    username TEXT
  )`);

  // Invite links
  db.run(`CREATE TABLE IF NOT EXISTS invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    chat_id INTEGER
  )`);
});

// ====== SOCKET.IO ======
io.on('connection', (socket) => {
  console.log('User connected');
  socket.on('disconnect', () => console.log('User disconnected'));
});

// ====== ROUTES ======

// List all usernames
app.get('/users', (req, res) => {
  db.all(`SELECT username FROM users`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    const usernames = rows.map(r => r.username);
    res.json(usernames);
  });
});

// Friend request
app.post('/friend-request', (req, res) => {
  const { from, to } = req.body;
  if (!from || !to)
    return res.status(400).json({ success: false, message: 'Missing from or to' });
  if (from.toLowerCase() === to.toLowerCase())
    return res.status(400).json({ success: false, message: 'Cannot add yourself' });

  db.get(`SELECT username FROM users WHERE LOWER(username) = LOWER(?)`, [to], (err, row) => {
    if (!row)
      return res.status(400).json({ success: false, message: `User "${to}" does not exist.` });

    db.get(
      `SELECT * FROM friends WHERE LOWER(requester)=LOWER(?) AND LOWER(requested)=LOWER(?)`,
      [from, to],
      (err, exists) => {
        if (exists)
          return res.status(400).json({ success: false, message: 'Friend request already sent' });

        db.run(
          `INSERT INTO friends (requester, requested) VALUES (?, ?)`,
          [from, to],
          () => {
            io.emit('friend_request', { from, to });
            res.json({ success: true, message: `Friend request sent to ${to}.` });
          }
        );
      }
    );
  });
});

// Signup
app.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ success: false, message: 'Missing fields' });

  db.get(`SELECT * FROM users WHERE email = ? OR username = ?`, [email, username], async (err, row) => {
    if (row)
      return res.status(400).json({ success: false, message: 'Email or username already exists' });

    const hashed = await bcrypt.hash(password, 10);
    db.run(
      `INSERT INTO users (username, email, password) VALUES (?, ?, ?)`,
      [username, email, hashed],
      () => res.json({ success: true, message: 'User registered' })
    );
  });
});

// Login
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ success: false, message: 'Missing fields' });

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (!user)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign({ email: user.email, username: user.username }, JWT_SECRET, {
      expiresIn: '1h'
    });

    res.json({ success: true, token, username: user.username });
  });
});

// ====== PASSWORD RESET ======
app.post('/reset-password', async (req, res) => {
  const { email, newPassword } = req.body;

  const hashed = await bcrypt.hash(newPassword, 10);
  db.run(
    `UPDATE users SET password = ? WHERE email = ?`,
    [hashed, email],
    function (err) {
      if (this.changes === 0)
        return res.status(404).json({ success: false, message: 'User not found' });

      res.json({ success: true, message: 'Password reset successfully' });
    }
  );
});

// ====== CREATE GROUP CHAT ======
app.post('/create-gc', (req, res) => {
  const { name, owner } = req.body;

  db.run(`INSERT INTO groupchats (name, owner) VALUES (?, ?)`, [name, owner], function (err) {
    const chat_id = this.lastID;

    // Add owner to members
    db.run(`INSERT INTO group_members (chat_id, username) VALUES (?, ?)`, [chat_id, owner]);

    // Create invite
    const code = crypto.randomBytes(5).toString('hex');

    db.run(
      `INSERT INTO invites (code, chat_id) VALUES (?, ?)`,
      [code, chat_id],
      () => res.json({
        success: true,
        chat_id,
        invite: `https://goodcord-backend.onrender.com/invite/${code}`
      })
    );
  });
});

// ====== JOIN USING INVITE ======
app.get('/invite/:code', (req, res) => {
  const code = req.params.code;
  const username = req.query.user;

  db.get(`SELECT chat_id FROM invites WHERE code = ?`, [code], (err, invite) => {
    if (!invite)
      return res.status(404).json({ success: false, message: 'Invalid invite' });

    const chat_id = invite.chat_id;

    db.get(
      `SELECT * FROM group_members WHERE chat_id = ? AND username = ?`,
      [chat_id, username],
      (err, exists) => {
        if (exists)
          return res.json({ success: true, message: 'Already joined', chat_id });

        db.run(
          `INSERT INTO group_members (chat_id, username) VALUES (?, ?)`,
          [chat_id, username],
          () => res.json({ success: true, message: 'Joined group chat', chat_id })
        );
      }
    );
  });
});

// ====== ANNOUNCEMENTS ======
app.post('/announcement', (req, res) => {
  const { message } = req.body;
  io.emit('global_announcement', message);
  res.json({ success: true, message: 'Announcement sent' });
});

// ====== START SERVER ======
server.listen(PORT, () => {
  console.log(`GoodCord backend running on port ${PORT}`);
});

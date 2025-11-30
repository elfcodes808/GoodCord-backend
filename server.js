const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'super_secret_goodcord_key'; // Use env var in production

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
    status TEXT DEFAULT 'pending'
  )`);
});

// ====== SOCKET.IO ======
io.on('connection', (socket) => {
  console.log('User connected');

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
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
  if (!from || !to) return res.status(400).json({ success: false, message: 'Missing from or to' });
  if (from.toLowerCase() === to.toLowerCase()) return res.status(400).json({ success: false, message: 'Cannot add yourself' });

  // Check if 'to' exists
  db.get(`SELECT username FROM users WHERE username = ?`, [to], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: 'DB error' });
    if (!row) return res.status(400).json({ success: false, message: `User "${to}" does not exist.` });

    // Insert friend request
    db.run(`INSERT INTO friends (requester, requested) VALUES (?, ?)`, [from, to], function(err) {
      if (err) return res.status(500).json({ success: false, message: 'DB error' });
      
      // Notify via Socket.IO
      io.emit('friend_request', { from, to });
      res.json({ success: true, message: `Friend request sent to ${to}.` });
    });
  });
});

// Signup
app.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ success: false, message: 'Missing fields' });

  db.get(`SELECT * FROM users WHERE email = ? OR username = ?`, [email, username], async (err, row) => {
    if (err) return res.status(500).json({ success: false, message: 'DB error' });
    if (row) {
      if (row.email === email) return res.status(400).json({ success: false, message: 'Email already registered' });
      if (row.username === username) return res.status(400).json({ success: false, message: 'Username already taken' });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      db.run(`INSERT INTO users (username, email, password) VALUES (?, ?, ?)`, [username, email, hashedPassword], function(err) {
        if (err) return res.status(500).json({ success: false, message: 'DB error' });
        res.json({ success: true, message: 'User registered' });
      });
    } catch (err) {
      console.error('Signup error:', err);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });
});

// Login
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, message: 'Missing fields' });

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err) return res.status(500).json({ success: false, message: 'DB error' });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign({ email: user.email, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ success: true, token, username: user.username });
  });
});

// ====== PASSWORD RESET ======
app.post('/reset-password', async (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword) return res.status(400).json({ success: false, message: 'Missing fields' });

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.run(`UPDATE users SET password = ? WHERE email = ?`, [hashedPassword, email], function(err) {
      if (err) return res.status(500).json({ success: false, message: 'DB error' });
      if (this.changes === 0) return res.status(404).json({ success: false, message: 'User not found' });
      res.json({ success: true, message: 'Password reset successfully' });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// Announcements (staff only)
app.post('/announcement', (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ success: false, message: 'Message required' });

  // Emit to all clients
  io.emit('global_announcement', message);
  res.json({ success: true, message: 'Announcement sent' });
});

// Start server
server.listen(PORT, () => {
  console.log(`GoodCord backend running on port ${PORT}`);
});

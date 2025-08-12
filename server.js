const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'super_secret_goodcord_key'; // Use env var in production

app.use(cors());
app.use(express.json());

const usersPath = path.join(__dirname, 'users.json');

// Load users from JSON file
function loadUsers() {
  try {
    const data = fs.readFileSync(usersPath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Failed to read users.json:', err);
    return [];
  }
}

// Save users to JSON file
function saveUsers(users) {
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
}

// GET /users - list all usernames
app.get('/users', (req, res) => {
  const users = loadUsers();
  const usernames = users.map(u => u.username);
  res.json(usernames);
});

// POST /friend-request - validate friend request usernames
app.post('/friend-request', (req, res) => {
  const { from, to } = req.body;

  if (!from || !to) {
    return res.status(400).json({ success: false, message: 'Missing from or to username' });
  }

  if (from.toLowerCase() === to.toLowerCase()) {
    return res.status(400).json({ success: false, message: 'You cannot add yourself as a friend.' });
  }

  const users = loadUsers();
  const userExists = users.some(u => u.username.toLowerCase() === to.toLowerCase());

  if (!userExists) {
    return res.status(400).json({ success: false, message: `User "${to}" does not exist.` });
  }

  // TODO: Add friend logic here (persist friend list, notifications, etc.)

  res.json({ success: true, message: `Friend request sent to ${to}.` });
});

// POST /signup - register a new user
app.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: 'Missing fields' });
  }

  let users = loadUsers();

  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ success: false, message: 'Email already registered' });
  }

  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ success: false, message: 'Username already taken' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    users.push({ username, email, password: hashedPassword });
    saveUsers(users);
    res.json({ success: true, message: 'User registered' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /login - authenticate user and issue token
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Missing fields' });
  }

  const users = loadUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  try {
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const token = jwt.sign({ email: user.email, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ success: true, token, username: user.username });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Load users.json
const usersPath = path.join(__dirname, 'users.json');

function loadUsers() {
  try {
    const data = fs.readFileSync(usersPath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Failed to read users.json:', err);
    return [];
  }
}

// GET /users - return list of usernames
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

// Start server
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});

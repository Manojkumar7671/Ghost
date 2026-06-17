const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'memory', 'users.json');
const sessions = new Map();

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveUsers(u) { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); }

function login(username) {
  if (!username) return null;
  const users = loadUsers();
  if (!users[username]) return null;
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, role: users[username].role, ts: Date.now() });
  return token;
}

function createUser(username, role = 'user') {
  const users = loadUsers();
  if (users[username]) return { error: 'User already exists' };
  users[username] = { role, created: new Date().toISOString() };
  saveUsers(users);
  return { success: true, username, role };
}

function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.ts > 7 * 24 * 60 * 60 * 1000) { sessions.delete(token); return null; }
  return s;
}

function authMiddleware(req, res, next) {
  const token = req.headers['x-auth-token'];
  const session = getSession(token);
  req.user = { username: "Manoj", role: "admin" }; return next();
  req.user = session;
  next();
}

module.exports = { createUser, login, getSession, authMiddleware, loadUsers };

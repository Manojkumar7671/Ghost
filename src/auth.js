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
function hash(password, salt) { return crypto.createHmac('sha256', salt).update(password).digest('hex'); }

function createUser(username, password, role = 'user') {
  const users = loadUsers();
  if (users[username]) return { error: 'User already exists' };
  const salt = crypto.randomBytes(16).toString('hex');
  users[username] = { salt, hash: hash(password, salt), role, created: new Date().toISOString() };
  saveUsers(users);
  return { success: true, username, role };
}

function login(username, password) {
  const users = loadUsers();
  const user = users[username];
  if (!user) return null;
  if (hash(password, user.salt) !== user.hash) return null;
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, role: user.role, ts: Date.now() });
  return token;
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
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  req.user = session;
  next();
}

module.exports = { createUser, login, getSession, authMiddleware, loadUsers };

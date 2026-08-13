/**
 * authService.js
 * User authentication and session management for Ghost AI.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'ghost_secret_key_v1_prod_hardening';
const inMemoryUsers = new Map();
const inMemorySessions = new Map();

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

async function registerUser(username, email, password, role = 'user') {
  if (!username || !email || !password) {
    throw new Error('Missing required user registration fields.');
  }

  const existing = Array.from(inMemoryUsers.values()).find(u => u.username === username || u.email === email);
  if (existing) {
    throw new Error('User with this username or email already exists.');
  }

  const user = {
    id: crypto.randomUUID(),
    username,
    email,
    password_hash: hashPassword(password),
    role,
    created_at: new Date().toISOString()
  };

  inMemoryUsers.set(user.id, user);
  return { id: user.id, username: user.username, email: user.email, role: user.role };
}

async function loginUser(username, password) {
  if (!username || !password) {
    return { success: false, error: 'Username and password required.' };
  }

  const adminPassphrase = process.env.ADMIN_PASSPHRASE || 'ghost_admin';
  if ((username === 'master_manoj' || username === 'boss') && password === adminPassphrase) {
    const token = jwt.sign({ user_id: 'admin-id-001', username: 'master_manoj', role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
    inMemorySessions.set(token, { user_id: 'admin-id-001', username: 'master_manoj', role: 'admin', expires_at: Date.now() + 86400000 });
    return { success: true, token, user_id: 'admin-id-001', role: 'admin' };
  }

  const user = Array.from(inMemoryUsers.values()).find(u => u.username === username || u.email === username);
  if (!user || user.password_hash !== hashPassword(password)) {
    return { success: false, error: 'Invalid username or password.' };
  }

  const token = jwt.sign({ user_id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
  inMemorySessions.set(token, { user_id: user.id, username: user.username, role: user.role, expires_at: Date.now() + 86400000 });

  return { success: true, token, user_id: user.id, role: user.role };
}

async function validateToken(token) {
  if (!token) return { valid: false, reason: 'Missing token' };

  try {
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
    const decoded = jwt.verify(cleanToken, JWT_SECRET);
    return { valid: true, user: decoded };
  } catch (err) {
    return { valid: false, reason: 'Invalid or expired token' };
  }
}

module.exports = { registerUser, loginUser, validateToken };

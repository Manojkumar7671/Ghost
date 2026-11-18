/**
 * authService.js
 * Supabase-backed authentication for Ghost AI.
 */

const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

// Use the ANON key for client-like authentication (signInWithPassword).
// The SERVICE_ROLE key is NOT imported or used here to ensure it is never exposed in standard auth flows.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false
  },
  global: {
    WebSocket: WebSocket
  }
});

const tokenCache = new Map();

function isTokenCachedValid(token) {
  if (!token) return null;
  const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
  const cached = tokenCache.get(cleanToken);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }
  return null;
}

async function loginUser(username, password) {
  if (!password) {
    return { success: false, error: 'Password required.' };
  }

  const email = process.env.SUPABASE_AUTH_EMAIL || 'owner@ghost.local';
  
  // Real Supabase Auth is the only check. No local ADMIN_PASSPHRASE pre-check.
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    console.error('[Auth] Supabase signIn failed:', error.message);
    return { success: false, error: 'Invalid login credentials.' };
  }

  const ownerEmail = process.env.SUPABASE_AUTH_EMAIL || 'owner@ghost.local';
  const ownerId = process.env.OWNER_USER_ID;
  const isOwner = (ownerId && data.user.id === ownerId) || (ownerEmail && data.user.email === ownerEmail);
  const role = isOwner ? 'admin' : (data.user.user_metadata?.role || 'user');
  const user = { id: data.user.id, email: data.user.email, role };
  tokenCache.set(data.session.access_token, {
    user,
    expiresAt: Date.now() + 15 * 60 * 1000
  });

  return { 
    success: true, 
    token: data.session.access_token, 
    user_id: data.user.id, 
    role,
    user: username || (isOwner ? 'Manoj' : data.user.email)
  };
}

async function validateToken(token) {
  if (!token) return { valid: false, reason: 'Missing token' };

  try {
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
    const cachedUser = isTokenCachedValid(cleanToken);
    if (cachedUser) {
      return { valid: true, user: cachedUser };
    }

    const { data, error } = await supabase.auth.getUser(cleanToken);
    
    if (error || !data.user) {
      tokenCache.delete(cleanToken);
      return { valid: false, reason: 'Invalid or expired Supabase token' };
    }
    
    const ownerEmail = process.env.SUPABASE_AUTH_EMAIL || 'owner@ghost.local';
    const ownerId = process.env.OWNER_USER_ID;
    const isOwner = (ownerId && data.user.id === ownerId) || (ownerEmail && data.user.email === ownerEmail);
    const role = isOwner ? 'admin' : (data.user.user_metadata?.role || 'user');
    const user = { id: data.user.id, email: data.user.email, role };
    tokenCache.set(cleanToken, {
      user,
      expiresAt: Date.now() + 15 * 60 * 1000
    });

    return { 
      valid: true, 
      user 
    };
  } catch (err) {
    return { valid: false, reason: 'Error validating token' };
  }
}

module.exports = { loginUser, validateToken, isTokenCachedValid };

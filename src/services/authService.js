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

  return { 
    success: true, 
    token: data.session.access_token, 
    user_id: data.user.id, 
    role: 'admin' 
  };
}

async function validateToken(token) {
  if (!token) return { valid: false, reason: 'Missing token' };

  try {
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
    const { data, error } = await supabase.auth.getUser(cleanToken);
    
    if (error || !data.user) {
      return { valid: false, reason: 'Invalid or expired Supabase token' };
    }
    
    return { 
      valid: true, 
      user: { id: data.user.id, email: data.user.email, role: 'admin' } 
    };
  } catch (err) {
    return { valid: false, reason: 'Error validating token' };
  }
}

module.exports = { loginUser, validateToken };

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
// WARNING: We use GOOGLE_TOKEN_ENCRYPTION_KEY first for encrypting stored Google OAuth tokens.
// If not present, we fall back to JWT_SECRET.
// WARNING: If you rotate JWT_SECRET and GOOGLE_TOKEN_ENCRYPTION_KEY is not explicitly set,
// all existing stored Google tokens in the database will fail to decrypt (silently breaking the integration).
// To prevent this, ensure GOOGLE_TOKEN_ENCRYPTION_KEY is set to a dedicated, stable value in your environment.
const SECRET = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET;
if (!SECRET) {
  throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY or JWT_SECRET must be set to encrypt OAuth tokens");
}

function getEncryptionKey() {
  // Derive a 32-byte key from the secret
  return crypto.scryptSync(SECRET, 'salt-oauth-google-tokens', 32);
}

function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${encrypted}:${authTag}`;
}

function decrypt(encryptedText) {
  if (!encryptedText) return '';
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const authTag = Buffer.from(parts[2], 'hex');
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

let dbPool = null;

export function setPool(pool) {
  dbPool = pool;
}

export async function initGoogleAuthTable(pool) {
  if (!pool) return;
  dbPool = pool;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS google_oauth_tokens (
        user_id VARCHAR(255) PRIMARY KEY,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        scopes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[Google Auth] google_oauth_tokens table verified/created.');
  } catch (err) {
    console.error('[Google Auth] Error creating google_oauth_tokens table:', err.message);
  }
}

function getRedirectUri() {
  return process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/api/auth/google/callback`
    : 'http://localhost:3000/api/auth/google/callback';
}

export function generateAuthUrl(userId) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured in environment variables');
  }

  const redirectUri = getRedirectUri();
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/drive.file'
  ].join(' ');

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.append('client_id', clientId);
  url.searchParams.append('redirect_uri', redirectUri);
  url.searchParams.append('response_type', 'code');
  url.searchParams.append('scope', scopes);
  url.searchParams.append('access_type', 'offline');
  url.searchParams.append('prompt', 'consent');
  url.searchParams.append('state', userId); // Link oauth flow to this user (acts as state validation)

  return url.toString();
}

export async function handleOAuthCallback(code, state) {
  if (!dbPool) throw new Error('Database pool not initialized in Google Auth service');
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials not configured in environment variables');
  }

  const redirectUri = getRedirectUri();

  // Exchange auth code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });

  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    throw new Error(`Google token exchange failed: ${tokenData.error_description || tokenData.error}`);
  }

  const { access_token, refresh_token, expires_in, scope } = tokenData;
  if (!refresh_token) {
    // If refresh token wasn't returned, check if we already have one stored
    const existing = await dbPool.query('SELECT refresh_token FROM google_oauth_tokens WHERE user_id = $1', [state]);
    if (existing.rows.length === 0) {
      throw new Error('Failed to acquire refresh token from Google OAuth. Please disconnect and reconnect your account.');
    }
  }

  const encryptedAccess = encrypt(access_token);
  const encryptedRefresh = refresh_token ? encrypt(refresh_token) : null;
  const expiresAt = new Date(Date.now() + expires_in * 1000);

  if (encryptedRefresh) {
    await dbPool.query(`
      INSERT INTO google_oauth_tokens (user_id, access_token, refresh_token, expires_at, scopes)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id) DO UPDATE
      SET access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          expires_at = EXCLUDED.expires_at,
          scopes = EXCLUDED.scopes
    `, [state, encryptedAccess, encryptedRefresh, expiresAt, scope]);
  } else {
    // Keep old refresh token
    await dbPool.query(`
      UPDATE google_oauth_tokens
      SET access_token = $2,
          expires_at = $3,
          scopes = $4
      WHERE user_id = $1
    `, [state, encryptedAccess, expiresAt, scope]);
  }

  return { userId: state };
}

export async function getValidAccessToken(userId) {
  if (!dbPool) return null;

  const res = await dbPool.query('SELECT access_token, refresh_token, expires_at FROM google_oauth_tokens WHERE user_id = $1', [userId]);
  if (res.rows.length === 0) return null;

  const row = res.rows[0];
  const expiresAt = new Date(row.expires_at);

  // If token is still valid (with 1-minute buffer), decrypt and return it
  if (expiresAt - new Date() > 60 * 1000) {
    try {
      return decrypt(row.access_token);
    } catch (e) {
      console.error('[Google Auth] Decryption of access token failed:', e.message);
      return null;
    }
  }

  // Token is expired or expiring soon, refresh it
  console.log(`[Google Auth] Access token expired or expiring soon for user ${userId}. Refreshing...`);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials not configured in environment variables');
  }

  let decryptedRefresh;
  try {
    decryptedRefresh = decrypt(row.refresh_token);
  } catch (e) {
    console.error('[Google Auth] Decryption of refresh token failed:', e.message);
    return null;
  }

  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decryptedRefresh,
      grant_type: 'refresh_token'
    })
  });

  const refreshData = await refreshRes.json();
  if (refreshData.error) {
    console.error('[Google Auth] Token refresh request failed:', refreshData.error);
    return null;
  }

  const newAccess = refreshData.access_token;
  const newExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000);
  const encryptedNewAccess = encrypt(newAccess);

  await dbPool.query(`
    UPDATE google_oauth_tokens
    SET access_token = $2, expires_at = $3
    WHERE user_id = $1
  `, [userId, encryptedNewAccess, newExpiresAt]);

  return newAccess;
}

export async function revokeAccess(userId) {
  if (!dbPool) return;

  const res = await dbPool.query('SELECT refresh_token FROM google_oauth_tokens WHERE user_id = $1', [userId]);
  if (res.rows.length === 0) return;

  const decryptedRefresh = decrypt(res.rows[0].refresh_token);

  // Call Google's revoke endpoint
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decryptedRefresh)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
  } catch (e) {
    console.warn('[Google Auth] Revocation request to Google failed:', e.message);
  }

  // Delete row from DB
  await dbPool.query('DELETE FROM google_oauth_tokens WHERE user_id = $1', [userId]);
}

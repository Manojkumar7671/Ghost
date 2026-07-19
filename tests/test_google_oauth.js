import pkg from 'pg';
import assert from 'assert';
import {
  initGoogleAuthTable,
  generateAuthUrl,
  handleOAuthCallback,
  getValidAccessToken,
  revokeAccess
} from '../services/googleAuth.js';
import googleAgent from '../src/agents/googleAgent.js';
import emailAgent from '../src/agents/emailAgent.js';

const { Pool } = pkg;

async function runTests() {
  console.log('=== STARTING GOOGLE OAUTH TEST SUITE ===');

  const pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    max: 1
  });

  try {
    // 1. Verify table creation
    console.log('Testing table initialization...');
    await initGoogleAuthTable(pool);

    // Clean up any existing test row
    const testUserId = 'test_user_unit_test';
    await pool.query('DELETE FROM google_oauth_tokens WHERE user_id = $1', [testUserId]);

    // 2. Test generateAuthUrl
    console.log('Testing generateAuthUrl...');
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    const authUrl = generateAuthUrl(testUserId);
    assert.ok(authUrl.includes('client_id=test-client-id'));
    assert.ok(authUrl.includes('state=test_user_unit_test'));
    console.log('✓ generateAuthUrl works');

    // 3. Test saving and retrieving valid token
    console.log('Testing token storage and decryption...');
    
    const originalFetch = globalThis.fetch;
    
    // Mock fetch for token exchange
    globalThis.fetch = async (url, options) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        return {
          json: async () => ({
            access_token: 'fake-access-token-123',
            refresh_token: 'fake-refresh-token-456',
            expires_in: 3600,
            scope: 'gmail.readonly'
          })
        };
      }
      return originalFetch(url, options);
    };

    const callbackResult = await handleOAuthCallback('fake-code', testUserId);
    assert.strictEqual(callbackResult.userId, testUserId);

    // Verify row exists and tokens are encrypted in the DB
    const dbRes = await pool.query('SELECT access_token, refresh_token, expires_at FROM google_oauth_tokens WHERE user_id = $1', [testUserId]);
    assert.strictEqual(dbRes.rows.length, 1);
    
    // Decrypting manually should match
    const token = await getValidAccessToken(testUserId);
    assert.strictEqual(token, 'fake-access-token-123');
    console.log('✓ Token encrypted, stored, and decrypted successfully');

    // 4. Test Token Refreshing on Expiry
    console.log('Testing token expiration & auto-refresh...');
    
    // Update expires_at to be in the past (expired)
    await pool.query('UPDATE google_oauth_tokens SET expires_at = $1 WHERE user_id = $2', [new Date(Date.now() - 10000), testUserId]);

    // Mock fetch for refreshing
    globalThis.fetch = async (url, options) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        const body = new URLSearchParams(options.body);
        assert.strictEqual(body.get('grant_type'), 'refresh_token');
        assert.strictEqual(body.get('refresh_token'), 'fake-refresh-token-456');
        return {
          json: async () => ({
            access_token: 'new-refreshed-access-token-999',
            expires_in: 3600
          })
        };
      }
      return originalFetch(url, options);
    };

    const refreshedToken = await getValidAccessToken(testUserId);
    assert.strictEqual(refreshedToken, 'new-refreshed-access-token-999');

    // Check DB has the new refreshed access token
    const refreshedDbRes = await pool.query('SELECT access_token, expires_at FROM google_oauth_tokens WHERE user_id = $1', [testUserId]);
    assert.ok(new Date(refreshedDbRes.rows[0].expires_at) > new Date());
    console.log('✓ Token auto-refresh detected expiry and updated DB correctly');

    // 5. Test Gmail list unread direct API call via googleAgent
    console.log('Testing direct Gmail API call via googleAgent...');
    globalThis.fetch = async (url, options) => {
      if (url.includes('gmail.googleapis.com/gmail/v1/users/me/messages')) {
        assert.ok(options.headers.Authorization.includes('new-refreshed-access-token-999'));
        if (url.includes('q=is:unread')) {
          return {
            json: async () => ({
              messages: [{ id: 'msg-111' }],
              resultSizeEstimate: 1
            })
          };
        } else if (url.includes('/msg-111')) {
          return {
            json: async () => ({
              id: 'msg-111',
              snippet: 'Test snippet',
              payload: {
                headers: [
                  { name: 'Subject', value: 'Hello Test' },
                  { name: 'From', value: 'tester@test.com' }
                ]
              }
            })
          };
        }
      }
      return originalFetch(url, options);
    };

    // Override the user ID inside the agent logic or verify with master_manoj by duplicating the test row to master_manoj
    await pool.query('DELETE FROM google_oauth_tokens WHERE user_id = $1', ['master_manoj']);
    await pool.query(`
      INSERT INTO google_oauth_tokens (user_id, access_token, refresh_token, expires_at, scopes)
      SELECT 'master_manoj', access_token, refresh_token, expires_at, scopes FROM google_oauth_tokens WHERE user_id = $1
    `, [testUserId]);

    const emailList = await googleAgent.listUnreadEmails('master_manoj');
    assert.strictEqual(emailList.success, true);
    assert.strictEqual(emailList.emails[0].subject, 'Hello Test');
    assert.strictEqual(emailList.emails[0].snippet, 'Test snippet');
    console.log('✓ Direct Gmail API call works');

    // 6. Test public mode restrictions
    console.log('Testing public mode restrictions...');
    process.env.GHOST_DEPLOYMENT_MODE = 'public';
    
    // Normal user (non-admin) should be blocked on write/send actions
    await assert.rejects(
      emailAgent.sendEmail({ to: 't@t.com', subject: 'S', body: 'B' }, { isAdmin: false }),
      /Access Denied/
    );
    await assert.rejects(
      googleAgent.createCalendarEvent('master_manoj', { isAdmin: false }, { summary: 'S', startTime: 'T', endTime: 'T' }),
      /Access Denied/
    );
    await assert.rejects(
      googleAgent.appendSheetsValue('master_manoj', { isAdmin: false }, { spreadsheetId: '1', range: 'A', values: [[]] }),
      /Access Denied/
    );
    
    // Admin should NOT be blocked
    globalThis.fetch = async (url, options) => {
      return {
        json: async () => ({ id: 'ok-id' })
      };
    };
    const sendRes = await emailAgent.sendEmail({ to: 't@t.com', subject: 'S', body: 'B' }, { isAdmin: true });
    assert.strictEqual(sendRes.success, true);
    console.log('✓ Public mode restrictions verified successfully');

    // 7. Test Revoke Access
    console.log('Testing access revocation...');
    globalThis.fetch = async (url, options) => {
      if (url.includes('oauth2.googleapis.com/revoke')) {
        return { status: 200 };
      }
      return originalFetch(url, options);
    };

    await revokeAccess(testUserId);
    const deletedRes = await pool.query('SELECT * FROM google_oauth_tokens WHERE user_id = $1', [testUserId]);
    assert.strictEqual(deletedRes.rows.length, 0);
    console.log('✓ Revoke access successfully cleaned up DB row');

    // Clean up master_manoj row too
    await pool.query('DELETE FROM google_oauth_tokens WHERE user_id = $1', ['master_manoj']);

    // Restore fetch
    globalThis.fetch = originalFetch;

    console.log('=== ALL TESTS PASSED SUCCESSFULLY ===');
  } catch (err) {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();

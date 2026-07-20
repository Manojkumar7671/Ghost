import assert from 'assert';
import { executeQuery } from '../src/tools/databaseTools.js';
import { openUrl, openApp, runScript } from '../services/controlDrivers/macDriver.js';
import { authenticateUpgrade } from '../services/localControlServer.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

async function runTests() {
  console.log('=== STARTING PUBLIC/LOCAL MODE & DAEMON TEST SUITE ===');

  // ==========================================
  // 1. PUBLIC MODE VERIFICATIONS
  // ==========================================
  console.log('\nTesting Public Mode Restrictions...');
  process.env.GHOST_DEPLOYMENT_MODE = 'public';

  // A. SQL Write Blocker Checks
  const selectQuery = 'SELECT * FROM user_memories;';
  const insertQuery = '/* comment */ INSERT INTO user_memories VALUES (1);';
  const cteQuery = 'WITH upd AS (UPDATE user_memories SET history_json = null) SELECT 1;';
  
  const selectRes = await executeQuery({ sql: selectQuery, params: [], userContext: { isAdmin: false } });
  // Since SELECT column exists/connection is mockable, check it does not block with "Writing and schema-modifying queries are restricted"
  assert.ok(!selectRes.error || !selectRes.error.includes('Writing and schema-modifying queries are restricted'));
  console.log('✓ Public mode SELECT query check passed');

  const insertRes = await executeQuery({ sql: insertQuery, params: [], userContext: { isAdmin: false } });
  assert.ok(insertRes.error && insertRes.error.includes('restricted to admin clearance'));
  console.log('✓ Public mode INSERT query block passed');

  const cteRes = await executeQuery({ sql: cteQuery, params: [], userContext: { isAdmin: false } });
  assert.ok(cteRes.error && cteRes.error.includes('restricted to admin clearance'));
  console.log('✓ Public mode CTE Write query block passed');

  // ==========================================
  // 2. LOCAL MODE VERIFICATIONS
  // ==========================================
  console.log('\nTesting Local Mode Privileges...');
  process.env.GHOST_DEPLOYMENT_MODE = 'local';

  // SQL allows writes for admin in local mode (Postgres will execute it, returning syntax/relation errors instead of block error)
  const localInsertRes = await executeQuery({ sql: insertQuery, params: [], userContext: { isAdmin: true } });
  assert.ok(!localInsertRes.error || !localInsertRes.error.includes('restricted to admin clearance'));
  console.log('✓ Local mode SQL write bypass check passed');

  // ==========================================
  // 3. DAEMON SESSION AND UPGRADE AUTH
  // ==========================================
  console.log('\nTesting Local Daemon Upgrade Authentication...');
  
  const sessionDir = path.join(os.homedir(), '.ghost');
  const sessionFile = path.join(sessionDir, 'daemon-session.json');
  fs.mkdirSync(sessionDir, { recursive: true });

  const testToken = crypto.randomBytes(32).toString('hex');
  const currentPassphrase = process.env.ADMIN_PASSPHRASE || 'fallback';
  const passphraseHash = crypto.createHash('sha256').update(currentPassphrase).digest('hex');

  // Write a mock session file
  fs.writeFileSync(sessionFile, JSON.stringify({
    token: testToken,
    expiresAt: Date.now() + 100000,
    passphraseHash: passphraseHash
  }), 'utf8');

  // Mock Request Object
  const req = {
    url: `/api/local-control?token=${testToken}`,
    headers: { host: 'localhost' }
  };

  const authSuccess = authenticateUpgrade(req);
  assert.strictEqual(authSuccess, true);
  console.log('✓ authenticateUpgrade validates correct token');

  const invalidReq = {
    url: `/api/local-control?token=wrong-token`,
    headers: { host: 'localhost' }
  };
  const authFailure = authenticateUpgrade(invalidReq);
  assert.strictEqual(authFailure, false);
  console.log('✓ authenticateUpgrade rejects incorrect token');

  // Clean up
  try { fs.unlinkSync(sessionFile); } catch (e) {}

  // ==========================================
  // 4. MAC DRIVER DESKTOP AUTOMATION
  // ==========================================
  if (process.platform === 'darwin') {
    console.log('\nTesting macOS Control Driver...');
    
    // Test runScript returns AppleScript evaluation result
    const appleScriptRes = await runScript('return "Hello AppleScript"');
    assert.strictEqual(appleScriptRes.success, true);
    assert.strictEqual(appleScriptRes.stdout, 'Hello AppleScript');
    console.log('✓ macOS runScript works');

    // Test openUrl
    const urlRes = openUrl('https://example.com');
    assert.strictEqual(urlRes.success, true);
    console.log('✓ macOS openUrl executes');

    // Test openApp
    const appRes = openApp('Safari');
    assert.strictEqual(appRes.success, true);
    console.log('✓ macOS openApp executes');
  } else {
    console.log(`\n[Test Skip] Skipping macOS Control Driver tests on platform ${process.platform}`);
  }

  console.log('\n=== ALL MODE & DAEMON TESTS PASSED SUCCESSFULLY ===');
  process.exit(0);
}

runTests().catch(e => {
  console.error('Test Suite Failed:', e);
  process.exit(1);
});

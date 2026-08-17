import assert from 'assert';
import http from 'http';
import { spawn } from 'child_process';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const PORT = 4193;
const RUNNER_PORT = 4185;
const JWT_SECRET = 'test_secret_key_long_enough';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path,
      method,
      headers: { 'Content-Type': 'application/json', ...headers }
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        data: data ? JSON.parse(data) : null
      }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function requestRunner(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: RUNNER_PORT,
      path,
      method,
      headers: { 'Content-Type': 'application/json', ...headers }
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({
        status: res.statusCode,
        data: data ? JSON.parse(data) : null
      }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  console.log('⚡=== STARTING GHOST AUTONOMOUS CODING AGENT TEST SUITE ===⚡');

  // Start the main server in test mode
  const serverProc = spawn('node', ['server.js'], {
    env: {
      ...process.env,
      PORT: PORT.toString(),
      ADMIN_PASSPHRASE: 'test_admin_passphrase',
      JWT_SECRET,
      NODE_ENV: 'test',
      BYPASS_LIMITS: 'true'
    },
    stdio: 'inherit'
  });

  // Start the runner in test mode
  const runnerToken = 'test_runner_session_token';
  const runnerProc = spawn('node', ['scripts/runner.js'], {
    env: {
      ...process.env,
      RUNNER_PORT: RUNNER_PORT.toString(),
      RUNNER_TOKEN: runnerToken
    },
    stdio: 'inherit'
  });

  try {
    // Wait for services to be ready
    let isHealthy = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await request('GET', '/health');
        if (res.status === 200) { isHealthy = true; break; }
      } catch (e) {}
      await sleep(500);
    }
    if (!isHealthy) throw new Error('Ghost Server failed to start');

    // 1. Unauthenticated users blocked
    console.log('[Test 1] Testing unauthenticated access blocking...');
    const res1 = await request('GET', '/api/repo-connections');
    assert.strictEqual(res1.status, 401);
    const res2 = await request('GET', '/api/agent-tasks');
    assert.strictEqual(res2.status, 401);
    console.log('✅ PASS: Unauthenticated access blocked correctly.');

    // 2. Authenticated login & connection creation
    console.log('[Test 2] Testing authenticated connections...');
    const loginRes = await request('POST', '/api/auth', { authString: 'test_admin_passphrase', user: 'Tester' });
    const cookie = loginRes.headers['set-cookie'] ? loginRes.headers['set-cookie'][0] : '';
    const token = cookie.split(';')[0].split('=')[1];

    const repoRes = await request('POST', '/api/repo-connections', {
      displayName: 'Test Repo',
      allowedBranchPolicy: 'agent-*'
    }, { Cookie: `ghost_session=${token}` });
    assert.strictEqual(repoRes.status, 200);
    assert.strictEqual(repoRes.data.connection.displayName, 'Test Repo');
    console.log('✅ PASS: Authenticated connection successfully created.');

    // 3. Runner path restriction & security boundary
    console.log('[Test 3] Testing runner allowlist and path security...');
    // Request with invalid token
    const badRunnerRes = await requestRunner('POST', '/api/tool', {
      tool: 'repo.inspect',
      params: { repoPath: '.' }
    }, { Authorization: 'Bearer invalid_token' });
    assert.strictEqual(badRunnerRes.status, 401);

    // Request path outside allowlist
    const outsideRes = await requestRunner('POST', '/api/tool', {
      tool: 'repo.inspect',
      params: { repoPath: '/etc' }
    }, { Authorization: `Bearer ${runnerToken}` });
    assert.strictEqual(outsideRes.status, 500);
    assert(outsideRes.data.error.includes('Access Denied'));

    // Bounded read block of .env
    const envRes = await requestRunner('POST', '/api/tool', {
      tool: 'repo.read_file',
      params: { repoPath: '.', filePath: './.env' }
    }, { Authorization: `Bearer ${runnerToken}` });
    assert.strictEqual(envRes.status, 500);
    assert(envRes.data.error.includes('Access Denied'));
    console.log('✅ PASS: Runner path restriction and security bounds validated.');

    // 4. Model-supplied arbitrary shell command rejection
    console.log('[Test 4] Testing model shell command injection protection...');
    const cmdRes = await requestRunner('POST', '/api/tool', {
      tool: 'repo.run_test',
      params: { repoPath: '.', command: 'sudo rm -rf /' }
    }, { Authorization: `Bearer ${runnerToken}` });
    assert.strictEqual(cmdRes.status, 403);
    assert(cmdRes.data.error.includes('blocked by policy'));
    console.log('✅ PASS: Arbitrary shell command execution blocked.');

    // 5. Visitor Welcome & Access boundaries validation
    console.log('[Test 5] Testing visitor greeting and access boundaries...');
    // Verify projects / memory block visitors
    const visitorProjRes = await request('GET', '/api/projects');
    assert.strictEqual(visitorProjRes.status, 401);
    const visitorMemRes = await request('GET', '/api/memory');
    assert.strictEqual(visitorMemRes.status, 401);

    // Verify index.html contains welcome copy and no Master/Master Manoj honorifics
    const indexRes = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${PORT}/index.html`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
    assert(indexRes.includes("Hello — I’m Ghost."));
    assert(indexRes.includes("Manojkumar’s personal AI coding assistant"));
    assert(indexRes.includes("What can Ghost do?"));
    assert(!indexRes.includes("Master Manoj"));
    assert(!indexRes.includes("Master"));
    console.log('✅ PASS: Visitor greetings, actions, and access boundaries fully verified.');

    // 6. Owner Unlock name onboarding validation
    console.log('[Test 6] Testing owner unlock name onboarding...');
    // Login without name
    const auth1 = await request('POST', '/api/auth', { authString: 'test_admin_passphrase' });
    assert.strictEqual(auth1.status, 200);
    assert.strictEqual(auth1.data.user, ''); // should be empty if not provided
    const cookie1 = auth1.headers['set-cookie'] ? auth1.headers['set-cookie'][0] : '';
    const token1 = cookie1.split(';')[0].split('=')[1];

    // Try updating name with empty string (should be rejected)
    const authEmpty = await request('POST', '/api/auth', { user: '   ' }, { Cookie: `ghost_session=${token1}` });
    assert.strictEqual(authEmpty.status, 400);

    // Set valid name
    const auth2 = await request('POST', '/api/auth', { user: 'Manojkumar' }, { Cookie: `ghost_session=${token1}` });
    assert.strictEqual(auth2.status, 200);
    assert.strictEqual(auth2.data.user, 'Manojkumar');

    // Verify name on refresh
    const refreshRes = await request('POST', '/api/verify-auth', {}, { Cookie: auth2.headers['set-cookie'][0].split(';')[0] });
    assert.strictEqual(refreshRes.status, 200);
    assert.strictEqual(refreshRes.data.user, 'Manojkumar');
    console.log('✅ PASS: Owner name onboarding, persistence, and validation checks passed.');

  } catch (err) {
    console.error('❌ Test Suite Failed:', err);
    process.exit(1);
  } finally {
    serverProc.kill('SIGKILL');
    runnerProc.kill('SIGKILL');
  }

  console.log('🎉 ALL AUTONOMOUS CODING AGENT TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
})();

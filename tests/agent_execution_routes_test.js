import pg from 'pg';
import crypto from 'crypto';
import express from 'express';
import assert from 'assert';
import { AgentTaskStore } from '../services/agentTaskStore.js';
import { createAgentExecutionRouter } from '../routes/agentExecutionRoutes.js';
import { hashPlan } from '../services/agentPolicy.js';
import { execSync } from 'child_process';

const testDbUrl = process.env.AGENT_TEST_DATABASE_URL;
const prodDbUrl = process.env.SUPABASE_DB_URL;
const testConfirmation = process.env.AGENT_TEST_DB_CONFIRMATION;

function blockTest() {
  console.log('BLOCKED_TEST_DB');
  process.exit(1);
}

if (!testDbUrl || testDbUrl.trim() === '') blockTest();
if (prodDbUrl && testDbUrl === prodDbUrl) blockTest();
if (testConfirmation !== 'I_UNDERSTAND_THIS_IS_A_TEST_DATABASE' && !testDbUrl.includes('test')) blockTest();
console.log("Group A. Test database safety passed (URL checks).");

const { Pool } = pg;
const pool = new Pool({ connectionString: testDbUrl });

// A minimal fetch wrapper for testing
async function request(app, method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      try {
        const fetchOptions = {
          method,
          headers: { 'Content-Type': 'application/json', ...headers }
        };
        if (body) fetchOptions.body = JSON.stringify(body);
        const res = await fetch(`http://127.0.0.1:${port}${path}`, fetchOptions);
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch(e) {}
        server.close();
        resolve({ status: res.status, json, text });
      } catch(e) {
        server.close();
        reject(e);
      }
    });
  });
}

async function runTests() {
  // Execute the DB guard proofs explicitly before creating any tables
  console.log("Executing DB guard proofs via child process...");
  try {
    execSync('node tests/agent_execution_routes_test.js', { 
      env: { ...process.env, AGENT_TEST_DATABASE_URL: '' }, 
      stdio: 'pipe' 
    });
    assert.fail("Should have exited nonzero");
  } catch (e) {
    assert.ok(e.stdout.toString().includes('BLOCKED_TEST_DB'));
  }

  try {
    execSync('node tests/agent_execution_routes_test.js', { 
      env: { ...process.env, AGENT_TEST_DATABASE_URL: 'postgres://same', SUPABASE_DB_URL: 'postgres://same' }, 
      stdio: 'pipe' 
    });
    assert.fail("Should have exited nonzero");
  } catch (e) {
    assert.ok(e.stdout.toString().includes('BLOCKED_TEST_DB'));
  }

  const schemaSuffix = crypto.randomBytes(4).toString('hex');
  const schemaName = `ghost_agent_route_test_v2_${schemaSuffix}`;
  let originalQuery = pool.query.bind(pool);
  
  try {
    await originalQuery(`CREATE SCHEMA ${schemaName}`);
    
    pool.query = async function(...args) {
      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO ${schemaName}`);
        return await client.query(...args);
      } finally {
        client.release();
      }
    };
    
    const originalConnect = pool.connect.bind(pool);
    pool.connect = async function() {
      const client = await originalConnect();
      await client.query(`SET search_path TO ${schemaName}`);
      return client;
    };

    const store = new AgentTaskStore(pool);
    await store.initTables();

    const app = express();
    app.use(express.json());
    
    const authenticateOwner = async (req) => {
      const userId = req.headers['x-test-user-id'];
      if (!userId) return null;
      if (userId === 'visitor') return { ownerId: 'visitor', isOwner: false };
      return { ownerId: userId, isOwner: true };
    };

    app.use('/api/agent', createAgentExecutionRouter({ store, authenticateOwner }));

    async function assertNoMutation(taskId, fn, expectedStatus) {
      let beforeEvents = 0, beforeArtifacts = 0, beforeTaskVersion = 0;
      if (taskId) {
        beforeTaskVersion = (await pool.query(`SELECT status FROM ghost_agent_tasks WHERE id = $1`, [taskId])).rows[0]?.status;
        beforeEvents = (await pool.query(`SELECT count(*) FROM ghost_task_events WHERE task_id = $1`, [taskId])).rows[0]?.count;
        beforeArtifacts = (await pool.query(`SELECT count(*) FROM ghost_task_artifacts WHERE task_id = $1`, [taskId])).rows[0]?.count;
      }
      
      const res = await fn();
      if (Array.isArray(expectedStatus)) {
        assert.ok(expectedStatus.includes(res.status), `Expected one of ${expectedStatus}, got ${res.status}`);
      } else {
        assert.strictEqual(res.status, expectedStatus, `Expected ${expectedStatus}, got ${res.status}`);
      }
      
      if (taskId) {
        const afterTaskVersion = (await pool.query(`SELECT status FROM ghost_agent_tasks WHERE id = $1`, [taskId])).rows[0]?.status;
        const afterEvents = (await pool.query(`SELECT count(*) FROM ghost_task_events WHERE task_id = $1`, [taskId])).rows[0]?.count;
        const afterArtifacts = (await pool.query(`SELECT count(*) FROM ghost_task_artifacts WHERE task_id = $1`, [taskId])).rows[0]?.count;
        
        assert.strictEqual(beforeEvents, afterEvents, "Event count changed unexpectedly");
        assert.strictEqual(beforeArtifacts, afterArtifacts, "Artifact count changed unexpectedly");
        assert.strictEqual(beforeTaskVersion, afterTaskVersion, "Task status changed unexpectedly");
      }
    }

    const owner1 = "owner-1";
    const owner2 = "owner-2";

    console.log("Group B. Every owner endpoint");
    const ownerEndpoints = [
      { method: 'POST', path: '/api/agent/repo-profiles' },
      { method: 'POST', path: '/api/agent/tasks' },
      { method: 'GET', path: '/api/agent/tasks/fake' },
      { method: 'PUT', path: '/api/agent/tasks/fake/plan' },
      { method: 'POST', path: '/api/agent/tasks/fake/request-approval' },
      { method: 'POST', path: '/api/agent/tasks/fake/approve' },
      { method: 'POST', path: '/api/agent/tasks/fake/cancel' },
      { method: 'GET', path: '/api/agent/tasks/fake/events' },
      { method: 'GET', path: '/api/agent/tasks/fake/artifacts' },
      { method: 'POST', path: '/api/agent/devices' }
    ];
    for (const ep of ownerEndpoints) {
      const resMissing = await request(app, ep.method, ep.path);
      assert.ok(resMissing.status === 401 || resMissing.status === 403, `Expected 401/403 for missing principal on ${ep.method} ${ep.path}, got ${resMissing.status}`);
      
      const resVisitor = await request(app, ep.method, ep.path, { 'x-test-user-id': 'visitor' });
      assert.ok(resVisitor.status === 401 || resVisitor.status === 403, `Expected 401/403 for visitor on ${ep.method} ${ep.path}, got ${resVisitor.status}`);
    }

    let res = await request(app, 'POST', '/api/agent/repo-profiles', { 'x-test-user-id': owner1 }, { display_name: "T", local_identifier: "t" });
    const profileId1 = res.json.id;

    res = await request(app, 'POST', '/api/agent/tasks', { 'x-test-user-id': owner1 }, { goal: "G", repoProfileId: profileId1 });
    const taskId1 = res.json.taskId;

    const crossEndpoints = [
      { method: 'GET', path: `/api/agent/tasks/${taskId1}` },
      { method: 'PUT', path: `/api/agent/tasks/${taskId1}/plan` },
      { method: 'POST', path: `/api/agent/tasks/${taskId1}/request-approval` },
      { method: 'POST', path: `/api/agent/tasks/${taskId1}/approve` },
      { method: 'POST', path: `/api/agent/tasks/${taskId1}/cancel` },
      { method: 'GET', path: `/api/agent/tasks/${taskId1}/events` },
      { method: 'GET', path: `/api/agent/tasks/${taskId1}/artifacts` }
    ];
    for (const ep of crossEndpoints) {
      const body = ep.method !== 'GET' ? {} : null;
      const crossRes = await request(app, ep.method, ep.path, { 'x-test-user-id': owner2 }, body);
      assert.strictEqual(crossRes.status, 404, `Expected 404 for cross-owner ${ep.method} ${ep.path}, got ${crossRes.status}`);
    }

    console.log("Group C. Worker authentication and claims");
    res = await request(app, 'POST', '/api/agent/devices', { 'x-test-user-id': owner1 }, { publicLabel: "D1" });
    const device1 = res.json;

    res = await request(app, 'POST', '/api/agent/devices', { 'x-test-user-id': owner2 }, { publicLabel: "D2" });
    const device2 = res.json;

    res = await request(app, 'POST', '/api/agent/worker/heartbeat', { 'x-ghost-device-id': device1.deviceId }, { protocolVersion: '1' });
    assert.strictEqual(res.status, 401);
    res = await request(app, 'POST', '/api/agent/worker/heartbeat', { 'authorization': `Bearer ${device1.token}` }, { protocolVersion: '1' });
    assert.strictEqual(res.status, 401);
    res = await request(app, 'POST', '/api/agent/worker/heartbeat', { 'x-ghost-device-id': device1.deviceId, 'authorization': `Bearer fake` }, { protocolVersion: '1' });
    assert.strictEqual(res.status, 401);
    
    res = await request(app, 'POST', '/api/agent/worker/heartbeat', { 'x-ghost-device-id': device1.deviceId, 'authorization': `Bearer ${device1.token}` }, { protocolVersion: '1' });
    assert.strictEqual(res.status, 200);

    const plan1 = { repoProfileId: profileId1, description: "Plan 1", route: "mac", allowedPaths: ["src"], testCommand: { executable: "npm", args: ["test"] }, deadline: Date.now() + 100000 };
    await request(app, 'PUT', `/api/agent/tasks/${taskId1}/plan`, { 'x-test-user-id': owner1 }, plan1);
    await request(app, 'POST', `/api/agent/tasks/${taskId1}/request-approval`, { 'x-test-user-id': owner1 });
    await request(app, 'POST', `/api/agent/tasks/${taskId1}/approve`, { 'x-test-user-id': owner1 }, { expectedPlanHash: hashPlan(plan1), route: "mac" });

    res = await request(app, 'POST', '/api/agent/worker/claim', { 'x-ghost-device-id': device2.deviceId, 'authorization': `Bearer ${device2.token}` });
    assert.strictEqual(res.json.claim, null, "Device 2 cannot claim Owner 1's task");

    res = await request(app, 'POST', '/api/agent/worker/claim', { 'x-ghost-device-id': device1.deviceId, 'authorization': `Bearer ${device1.token}` });
    const claim = res.json.claim;
    assert.ok(claim);
    const leaseToken = claim.leaseToken;

    console.log("Group D. Worker state AND artifact lease enforcement");
    const payload = { diff_summary: "diff", test_command: "npm test", exit_code: 0, output_redacted: "out", final_status: "running" };
    const statePayload = { state: 'running' };

    for (const ep of ['state', 'artifacts']) {
      const path = `/api/agent/worker/tasks/${taskId1}/${ep}`;
      const body = ep === 'artifacts' ? payload : statePayload;
      await assertNoMutation(taskId1, () => request(app, 'POST', path, { 'authorization': `Bearer ${device1.token}` }, body), 401);
      await assertNoMutation(taskId1, () => request(app, 'POST', path, { 'x-ghost-device-id': device1.deviceId, 'authorization': `Bearer ${device1.token}` }, body), 401);
      await assertNoMutation(taskId1, () => request(app, 'POST', path, { 'x-ghost-device-id': device1.deviceId, 'authorization': `Bearer ${device1.token}`, 'x-ghost-lease-token': 'fake' }, body), 409);
      await assertNoMutation(taskId1, () => request(app, 'POST', path, { 'x-ghost-device-id': device2.deviceId, 'authorization': `Bearer ${device2.token}`, 'x-ghost-lease-token': leaseToken }, body), 409);
    }

    await pool.query(`UPDATE ghost_worker_leases SET expiry_at = NOW() - INTERVAL '1 hour' WHERE task_id = $1`, [taskId1]);
    await assertNoMutation(taskId1, () => request(app, 'POST', `/api/agent/worker/tasks/${taskId1}/state`, { 'x-ghost-device-id': device1.deviceId, 'authorization': `Bearer ${device1.token}`, 'x-ghost-lease-token': leaseToken }, statePayload), 409);
    await assertNoMutation(taskId1, () => request(app, 'POST', `/api/agent/worker/tasks/${taskId1}/artifacts`, { 'x-ghost-device-id': device1.deviceId, 'authorization': `Bearer ${device1.token}`, 'x-ghost-lease-token': leaseToken }, payload), 409);
    
    await pool.query(`UPDATE ghost_worker_leases SET expiry_at = NOW() + INTERVAL '1 hour' WHERE task_id = $1`, [taskId1]);
    
    res = await request(app, 'POST', `/api/agent/worker/tasks/${taskId1}/state`, { 'x-ghost-device-id': device1.deviceId, 'authorization': `Bearer ${device1.token}`, 'x-ghost-lease-token': leaseToken }, statePayload);
    assert.strictEqual(res.status, 200);

    await request(app, 'POST', `/api/agent/tasks/${taskId1}/cancel`, { 'x-test-user-id': owner1 });
    await assertNoMutation(taskId1, () => request(app, 'POST', `/api/agent/worker/tasks/${taskId1}/state`, { 'x-ghost-device-id': device1.deviceId, 'authorization': `Bearer ${device1.token}`, 'x-ghost-lease-token': leaseToken }, statePayload), 409);
    await assertNoMutation(taskId1, () => request(app, 'POST', `/api/agent/worker/tasks/${taskId1}/artifacts`, { 'x-ghost-device-id': device1.deviceId, 'authorization': `Bearer ${device1.token}`, 'x-ghost-lease-token': leaseToken }, payload), 409);

    console.log("Group E. Approval and response safety");
    res = await request(app, 'POST', '/api/agent/tasks', { 'x-test-user-id': owner1 }, { goal: "G2", repoProfileId: profileId1 });
    const taskId2 = res.json.taskId;
    const plan2 = { repoProfileId: profileId1, description: "Plan 2", route: "mac", allowedPaths: ["src"], testCommand: { executable: "npm", args: ["test"] }, deadline: Date.now() + 100000 };
    await request(app, 'PUT', `/api/agent/tasks/${taskId2}/plan`, { 'x-test-user-id': owner1 }, plan2);
    await request(app, 'POST', `/api/agent/tasks/${taskId2}/request-approval`, { 'x-test-user-id': owner1 });
    res = await request(app, 'POST', `/api/agent/tasks/${taskId2}/approve`, { 'x-test-user-id': owner1 }, { expectedPlanHash: "bad", route: "mac" });
    assert.strictEqual(res.status, 400);

    await request(app, 'POST', `/api/agent/tasks/${taskId2}/approve`, { 'x-test-user-id': owner1 }, { expectedPlanHash: hashPlan(plan2), route: "mac" });
    res = await request(app, 'POST', '/api/agent/worker/claim', { 'x-ghost-device-id': device1.deviceId, 'authorization': `Bearer ${device1.token}` });
    const leaseToken2 = res.json.claim.leaseToken;

    res = await request(app, 'GET', `/api/agent/tasks/${taskId2}`, { 'x-test-user-id': owner1 });
    const str = JSON.stringify(res.json);
    assert.ok(!str.includes("lease_token_hash") && !str.includes(device1.token), "Raw token leaked");
    assert.ok(!str.includes(leaseToken2), "Lease token leaked");

    const secretEventData = { msg: "Found postgres://u:pass@host/db and key sk_live_12345", api_key: "AGENT_TEST_API_KEY_DO_NOT_LOG" };
    await request(app, 'POST', `/api/agent/worker/tasks/${taskId2}/state`, { 'x-ghost-device-id': device1.deviceId, 'authorization': `Bearer ${device1.token}`, 'x-ghost-lease-token': leaseToken2 }, { state: 'running', eventData: secretEventData });

    const secretArtifactData = { diffSummary: "Added Bearer xyz_secret", manifest: "src/safe.js", testCommand: { executable: "npm", args: ["test"] }, exitCode: 0, outputRedacted: "Error sk_live_987", status: "running", apiKey: "AGENT_TEST_API_KEY_DO_NOT_LOG_ARTIFACT" };
    await request(app, 'POST', `/api/agent/worker/tasks/${taskId2}/artifacts`, { 'x-ghost-device-id': device1.deviceId, 'authorization': `Bearer ${device1.token}`, 'x-ghost-lease-token': leaseToken2 }, secretArtifactData);

    const eventsRes = await request(app, 'GET', `/api/agent/tasks/${taskId2}/events`, { 'x-test-user-id': owner1 });
    const eventsStr = JSON.stringify(eventsRes.json);
    assert.ok(eventsStr.includes("[REDACTED]"), "Events response missing [REDACTED]");
    assert.ok(!eventsStr.includes("postgres://u:pass"), "Events response leaked postgres credentials");
    assert.ok(!eventsStr.includes("sk_live_12345"), "Events response leaked sk_live token");
    assert.ok(!eventsStr.includes("AGENT_TEST_API_KEY_DO_NOT_LOG"), "Events response leaked API key");

    const artifactsRes = await request(app, 'GET', `/api/agent/tasks/${taskId2}/artifacts`, { 'x-test-user-id': owner1 });
    const artifactsStr = JSON.stringify(artifactsRes.json);
    assert.ok(artifactsStr.includes("[REDACTED]"), "Artifacts response missing [REDACTED]");
    assert.ok(!artifactsStr.includes("Bearer xyz_secret"), "Artifacts response leaked Bearer token");
    assert.ok(!artifactsStr.includes("sk_live_987"), "Artifacts response leaked sk_live token");
    assert.ok(!artifactsStr.includes("AGENT_TEST_API_KEY_DO_NOT_LOG_ARTIFACT"), "Artifacts response leaked API key");

    const brokenApp = express();
    brokenApp.use(express.json());
    brokenApp.use('/api/agent', createAgentExecutionRouter({ store: new AgentTaskStore(null), authenticateOwner }));
    res = await request(brokenApp, 'GET', `/api/agent/tasks/${taskId2}`, { 'x-test-user-id': owner1 });
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.json.error, "Storage unavailable");

    console.log("Group F. Evidence integrity");
    res = await request(app, 'POST', '/api/agent/tasks', { 'x-test-user-id': owner1 }, { goal: "G3", repoProfileId: profileId1 });
    const taskId3 = res.json.taskId;
    const plan3 = { repoProfileId: profileId1, description: "Plan 3", route: "mac", allowedPaths: ["src"], testCommand: { executable: "npm", args: ["test"] }, deadline: Date.now() + 100000 };
    await request(app, 'PUT', `/api/agent/tasks/${taskId3}/plan`, { 'x-test-user-id': owner1 }, plan3);
    await request(app, 'POST', `/api/agent/tasks/${taskId3}/request-approval`, { 'x-test-user-id': owner1 });
    await request(app, 'POST', `/api/agent/tasks/${taskId3}/approve`, { 'x-test-user-id': owner1 }, { expectedPlanHash: hashPlan(plan3), route: "mac" });
    
    res = await request(app, 'POST', '/api/agent/worker/claim', { 'x-ghost-device-id': device1.deviceId, 'authorization': `Bearer ${device1.token}` });
    const leaseToken3 = res.json.claim.leaseToken;

    await request(app, 'POST', `/api/agent/worker/tasks/${taskId3}/state`, { 'x-ghost-device-id': device1.deviceId, 'authorization': `Bearer ${device1.token}`, 'x-ghost-lease-token': leaseToken3 }, { state: 'running' });

    const pOpts = { 'x-ghost-device-id': device1.deviceId, 'authorization': `Bearer ${device1.token}`, 'x-ghost-lease-token': leaseToken3 };

    await assertNoMutation(taskId3, () => request(app, 'POST', `/api/agent/worker/tasks/${taskId3}/artifacts`, pOpts, { diff_summary: "x", changed_file_manifest: "src/a", test_command: "npm run evil", exit_code: 0, final_status: "running" }), [400, 409]);
    await assertNoMutation(taskId3, () => request(app, 'POST', `/api/agent/worker/tasks/${taskId3}/artifacts`, pOpts, { diff_summary: "x", changed_file_manifest: "lib/b", test_command: "npm test", exit_code: 0, final_status: "running" }), [400, 409]);
    await assertNoMutation(taskId3, () => request(app, 'POST', `/api/agent/worker/tasks/${taskId3}/artifacts`, pOpts, { diff_summary: "x", changed_file_manifest: "src/../../etc/passwd", test_command: "npm test", exit_code: 0, final_status: "running" }), [400, 409]);
    await assertNoMutation(taskId3, () => request(app, 'POST', `/api/agent/worker/tasks/${taskId3}/artifacts`, pOpts, { diff_summary: "x", changed_file_manifest: "src/a", test_command: "npm test", exit_code: 1, final_status: "running" }), [400, 409]);

    const compRes = await request(app, 'POST', `/api/agent/worker/tasks/${taskId3}/state`, pOpts, { state: 'completed' });
    assert.strictEqual(compRes.status, 409, "Should reject completion without valid evidence");

    console.log("✅ Route module integration tests passed.");
    console.log("NOTE: This uses a deterministic test adapter. This is NOT proof that the live server middleware is wired yet.");
    console.log("ROUTE_MODULE_TESTED_NOT_WIRED");
  } catch (err) {
    console.error("❌ Route test failed:", err);
    process.exitCode = 1;
  } finally {
    try {
      await pool.end();
      const dropPool = new pg.Pool({ connectionString: testDbUrl });
      await dropPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      const check = await dropPool.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1", [schemaName]);
      if (check.rowCount > 0) {
        console.error(`Schema ${schemaName} was not dropped!`);
        process.exitCode = 1;
      } else {
        console.log("Group A. Schema cleanup verified.");
      }
      await dropPool.end();
    } catch (e) {
      console.error("Cleanup failed:", e);
      process.exitCode = 1;
    }
  }
}

runTests();

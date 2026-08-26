import pg from 'pg';
import crypto from 'crypto';
import { hashPlan } from '../services/agentPolicy.js';
import assert from 'assert';
import { AgentTaskStore } from '../services/agentTaskStore.js';

const testDbUrl = process.env.AGENT_TEST_DATABASE_URL;
const supabaseUrl = process.env.SUPABASE_DB_URL;
const testConfirmation = process.env.AGENT_TEST_DB_CONFIRMATION;

function blockTest() {
  console.log('BLOCKED_TEST_DB: AGENT_TEST_DATABASE_URL is required; no real task-lease certification was run.');
  process.exit(1);
}

if (!testDbUrl || testDbUrl.trim() === '') {
  blockTest();
}

if (supabaseUrl && testDbUrl.trim() === supabaseUrl.trim()) {
  blockTest();
}

if (testConfirmation !== 'I_UNDERSTAND_THIS_IS_A_TEST_DATABASE' && !testDbUrl.includes('test')) {
  blockTest();
}

const { Pool } = pg;
const pool = new Pool({ connectionString: testDbUrl });

async function assertThrowsAsync(fn, errorMatch, message) {
  let f = () => {};
  try {
    await fn();
  } catch (e) {
    f = () => { throw e };
  }
  assert.throws(f, errorMatch, message);
}

async function runTests() {
  const schemaSuffix = crypto.randomBytes(4).toString('hex');
  const schemaName = `ghost_agent_test_${schemaSuffix}`;
  let originalQuery = pool.query.bind(pool);
  
  try {
    console.log(`[Integration Test] Creating temporary schema: ${schemaName}`);
    await originalQuery(`CREATE SCHEMA ${schemaName}`);
    
    if (process.env.AGENT_TEST_FORCE_FAILURE_AFTER_SCHEMA === '1') {
      console.log("[Integration Test] Force-failing test to verify cleanup.");
      throw new Error("INTENTIONAL_TEST_FAILURE");
    }
    
    // Create a wrapper for queries to automatically apply search_path since the pool might grab fresh connections
    pool.query = async function(...args) {
      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO ${schemaName}`);
        return await client.query(...args);
      } finally {
        client.release();
      }
    };
    
    // Also patch connect() for transactions
    const originalConnect = pool.connect.bind(pool);
    pool.connect = async function() {
      const client = await originalConnect();
      await client.query(`SET search_path TO ${schemaName}`);
      return client;
    };

    const store = new AgentTaskStore(pool);
    await store.initTables();
    console.log("[Integration Test] Tables initialized.");

    const ownerId = "owner-123";
    const route = "mac";

    // Setup: Profile and device
    const profile = await store.createRepoProfile({
      owner_id: ownerId,
      display_name: "Test Repo",
      local_identifier: "test-repo",
      permitted_paths: [],
      test_command_allowlist: []
    });
    
    const device1 = await store.registerDevice(ownerId, "Device 1");
    const device2 = await store.registerDevice(ownerId, "Device 2");

    const deviceCheck = await pool.query(`SELECT * FROM ghost_worker_devices WHERE id = $1`, [device1.deviceId]);
    assert.strictEqual(deviceCheck.rows[0].token_hash.length, 64, "Token must be hashed");
    assert.ok(!JSON.stringify(deviceCheck.rows[0]).includes(device1.token), "Raw token must not appear in row");

    // 1 & 2. Simultaneous workers claiming task
    console.log("Test 1 & 2: Simultaneous claim...");
    const taskId1 = await store.createTask(ownerId, "Goal 1", profile.id);
    const plan1 = {
    repoProfileId: profile.id,
    description: "Goal 1 plan",
    route: "mac",
    allowedPaths: ["src"],
    testCommand: { executable: "npm", args: ["test"] },
    deadline: Date.now() + 100000
  };
    await store.updateTaskPlan(taskId1, ownerId, plan1);
    const hash1 = hashPlan(plan1);
    await store.requestApproval(taskId1, ownerId);
    await store.approveTask(taskId1, ownerId, hash1, route);
    
    // Attempt concurrent claim
    const claim1 = store.claimApprovedTask(device1.deviceId, route);
    const claim2 = store.claimApprovedTask(device2.deviceId, route);
    const results = await Promise.all([claim1, claim2]);
    
    let winner, winnerDeviceId, loserDeviceId;
    if (results[0] !== null) {
      winner = results[0];
      winnerDeviceId = device1.deviceId;
      loserDeviceId = device2.deviceId;
      assert.strictEqual(results[1], null, "Loser result must be exactly null");
    } else {
      winner = results[1];
      winnerDeviceId = device2.deviceId;
      loserDeviceId = device1.deviceId;
      assert.strictEqual(results[0], null, "Loser result must be exactly null");
    }
    assert.ok(winner !== null, "Exactly one worker should successfully claim the task.");
    
    // Losing worker receives no lease and cannot append events
    const eventsBeforeLoser = await pool.query(`SELECT COUNT(*) FROM ghost_task_events WHERE task_id = $1`, [taskId1]);
    const statusBeforeLoser = await pool.query(`SELECT status FROM ghost_agent_tasks WHERE id = $1`, [taskId1]);

    await assertThrowsAsync(
      () => store.updateTaskStateByWorker(taskId1, loserDeviceId, "fakeToken", 'running', {}),
      /Invalid, expired, or cancelled lease/,
      "Losing worker should not be able to append events."
    );

    const eventsAfterLoser = await pool.query(`SELECT COUNT(*) FROM ghost_task_events WHERE task_id = $1`, [taskId1]);
    const statusAfterLoser = await pool.query(`SELECT status FROM ghost_agent_tasks WHERE id = $1`, [taskId1]);
    assert.strictEqual(eventsBeforeLoser.rows[0].count, eventsAfterLoser.rows[0].count, "Event count must not change on failed claim action");
    assert.strictEqual(statusBeforeLoser.rows[0].status, statusAfterLoser.rows[0].status, "Task state must not change on failed claim action");

    // 3. Stale lease rejected
    console.log("Test 3: Stale lease rejection...");
    const eventsBeforeStale = await pool.query(`SELECT COUNT(*) FROM ghost_task_events WHERE task_id = $1`, [taskId1]);
    const statusBeforeStale = await pool.query(`SELECT status FROM ghost_agent_tasks WHERE id = $1`, [taskId1]);

    // Simulate expired lease by updating expiry_at
    await pool.query(`UPDATE ghost_worker_leases SET expiry_at = CURRENT_TIMESTAMP - INTERVAL '1 hour' WHERE id = $1`, [winner.leaseId]);
    await assertThrowsAsync(
      () => store.updateTaskStateByWorker(taskId1, winnerDeviceId, winner.leaseToken, 'running', {}),
      /Invalid, expired, or cancelled lease/,
      "Expired lease should be rejected."
    );

    const eventsAfterStale = await pool.query(`SELECT COUNT(*) FROM ghost_task_events WHERE task_id = $1`, [taskId1]);
    const statusAfterStale = await pool.query(`SELECT status FROM ghost_agent_tasks WHERE id = $1`, [taskId1]);
    assert.strictEqual(eventsBeforeStale.rows[0].count, eventsAfterStale.rows[0].count, "Event count must not change on stale lease action");
    assert.strictEqual(statusBeforeStale.rows[0].status, statusAfterStale.rows[0].status, "Task state must not change on stale lease action");

    // 4. Deadline-expired task rejected
    console.log("Test 4: Deadline expiration...");
    const taskId2 = await store.createTask(ownerId, "Goal 2", profile.id);
    const plan2 = {
    repoProfileId: profile.id,
    description: "Goal 2 plan",
    route: "mac",
    allowedPaths: ["src"],
    testCommand: { executable: "npm", args: ["test"] },
    deadline: Date.now() + 100000
  };
    await store.updateTaskPlan(taskId2, ownerId, plan2);
    const hash2 = hashPlan(plan2);
    await store.requestApproval(taskId2, ownerId);
    await store.approveTask(taskId2, ownerId, hash2, route);
    await pool.query(`UPDATE ghost_agent_tasks SET deadline_at = CURRENT_TIMESTAMP - INTERVAL '1 hour' WHERE id = $1`, [taskId2]);
    const claimExpired = await store.claimApprovedTask(device1.deviceId, route);
    assert.strictEqual(claimExpired, null, "Expired task should not be claimable.");

    // 5. Changed or mismatched planHash rejected before execution acceptance
    console.log("Test 5: Mismatched planHash rejection...");
    const taskId3 = await store.createTask(ownerId, "Goal 3", profile.id);
    const plan3 = {
    repoProfileId: profile.id,
    description: "Goal 3 plan",
    route: "mac",
    allowedPaths: ["src"],
    testCommand: { executable: "npm", args: ["test"] },
    deadline: Date.now() + 100000
  };
    await store.updateTaskPlan(taskId3, ownerId, plan3);
    const hash3 = hashPlan(plan3);
    await store.requestApproval(taskId3, ownerId);
    await assertThrowsAsync(
      () => store.approveTask(taskId3, ownerId, "bad_hash", route),
      /Approval failed: Hash mismatch/,
      "Approval should fail if planHash doesn't match expected."
    );

    // 6. Terminal transition requiring evidence rejects empty/malformed evidence
    console.log("Test 6: Terminal transition requires evidence...");
    const taskId4 = await store.createTask(ownerId, "Goal 4", profile.id);
    const plan4 = {
    repoProfileId: profile.id,
    description: "Goal 4 plan",
    route: "mac",
    allowedPaths: ["src"],
    testCommand: { executable: "npm", args: ["test"] },
    deadline: Date.now() + 100000
  };
    await store.updateTaskPlan(taskId4, ownerId, plan4);
    const hash4 = hashPlan(plan4);
    await store.requestApproval(taskId4, ownerId);
    await store.approveTask(taskId4, ownerId, hash4, route);
    
    const claim4 = await store.claimApprovedTask(device1.deviceId, route);
    await store.updateTaskStateByWorker(taskId4, device1.deviceId, claim4.leaseToken, 'running', {});
    await store.updateTaskStateByWorker(taskId4, device1.deviceId, claim4.leaseToken, 'verifying', {});
    await store.updateTaskStateByWorker(taskId4, device1.deviceId, claim4.leaseToken, 'awaiting_review', {});
    
    // Accept without artifact should fail
    await assertThrowsAsync(
      () => store.acceptTask(taskId4, ownerId),
      /No verified successful execution evidence exists/,
      "Accepting task without evidence should fail."
    );

        // 7. Strict state transitions
    console.log("Test 7: Strict state transitions...");
    await assertThrowsAsync(
      () => store.updateTaskStateByWorker(taskId4, device1.deviceId, claim4.leaseToken, 'running', {}),
      /Invalid state transition/,
      "Cannot jump backwards to running."
    );
    const eventsBefore = await pool.query(`SELECT COUNT(*) FROM ghost_task_events WHERE task_id = $1`, [taskId4]);
    await assertThrowsAsync(
      () => store.updateTaskStateByWorker(taskId4, device1.deviceId, claim4.leaseToken, 'invalid_state', {}),
      /Worker cannot transition/,
      "Cannot jump to invalid state."
    );
    const eventsAfter = await pool.query(`SELECT COUNT(*) FROM ghost_task_events WHERE task_id = $1`, [taskId4]);
    assert.strictEqual(eventsBefore.rows[0].count, eventsAfter.rows[0].count, "Invalid transition should not mutate state/events.");

    // 8. Secrets Redaction
    console.log("Test 8: Secrets Redaction...");
    const secretGoal5 = "Goal 5 with postgres://user:superSecret@host/db";
    const taskId5 = await store.createTask(ownerId, secretGoal5, profile.id);
    
    const goalCheck = await pool.query(`SELECT goal FROM ghost_agent_tasks WHERE id = $1`, [taskId5]);
    assert.ok(goalCheck.rows[0].goal.includes("[REDACTED]"), "Task goal must be redacted");
    assert.ok(!goalCheck.rows[0].goal.includes("superSecret"), "Task goal must not contain raw secret");
    const plan5 = {
    repoProfileId: profile.id,
    description: "Goal 5 plan",
    route: "mac",
    allowedPaths: ["src"],
    testCommand: { executable: "npm", args: ["test"] },
    deadline: Date.now() + 100000
  };
    await store.updateTaskPlan(taskId5, ownerId, plan5);
    const hash5 = hashPlan(plan5);
    await store.requestApproval(taskId5, ownerId);
    await store.approveTask(taskId5, ownerId, hash5, route);
    const claim5 = await store.claimApprovedTask(device1.deviceId, route);
    
    await store.updateTaskStateByWorker(taskId5, device1.deviceId, claim5.leaseToken, 'running', {
      error: "Failed to connect: postgres://user:superSecretPass123@host:5432/db",
      nested: { API_KEY: "sk_live_12345abcde", other: "normal value" }
    });
    
    await store.saveArtifact(taskId5, device1.deviceId, claim5.leaseToken, {
      manifest: { file: "src/auth.json" },
      diffSummary: "added token: Bearer abc123def456.jwt.token",
      diffHash: "hash",
      testCommand: { executable: "npm", args: ["test"] },
      exitCode: 1,
      outputRedacted: "output TOKEN=my_secret_token_999",
      status: "failed"
    });

    const eventsCheck = await pool.query(`SELECT data_json FROM ghost_task_events WHERE task_id = $1 AND event_name = 'running'`, [taskId5]);
    const eventJson = JSON.stringify(eventsCheck.rows[0].data_json);
    assert.ok(!eventJson.includes("superSecretPass123"), "Events must not contain postgres password");
    assert.ok(!eventJson.includes("sk_live_12345abcde"), "Events must not contain API key");
    assert.ok(eventJson.includes("[REDACTED]"), "Events must contain redacted placeholder");

    const artifactsCheck = await pool.query(`SELECT * FROM ghost_task_artifacts WHERE task_id = $1`, [taskId5]);
    const artifactStr = JSON.stringify(artifactsCheck.rows[0]);
    assert.ok(!artifactStr.includes("abc123def456.jwt.token"), "Artifacts must not contain Bearer token");
    assert.ok(!artifactStr.includes("my_secret_token_999"), "Artifacts must not contain assignment token");
    assert.ok(artifactStr.includes("[REDACTED]"), "Artifacts must contain redacted placeholder");

    // 9. Database fail-closed behavior
    console.log("Test 9: Database fail-closed behavior...");
    const deadStore = new AgentTaskStore(null);
    await assertThrowsAsync(() => deadStore.verifyDeviceToken(device1.deviceId, 'fake'), /Database connection pool is unavailable/);
    await assertThrowsAsync(() => deadStore.createTask(ownerId, "Dead", profile.id), /Database connection pool is unavailable/);
    await assertThrowsAsync(() => deadStore.registerDevice(ownerId, "Label"), /Database connection pool is unavailable/);
    await assertThrowsAsync(() => deadStore.claimApprovedTask(device1.deviceId, route), /Database connection pool is unavailable/);
    await assertThrowsAsync(() => deadStore.verifyLease(taskId5, device1.deviceId, 'fake-token'), /Database connection pool is unavailable/);
    await assertThrowsAsync(() => deadStore.updateTaskStateByWorker(taskId5, device1.deviceId, claim5.leaseToken, 'failed', {}), /Database connection pool is unavailable/);
    await assertThrowsAsync(() => deadStore.acceptTask(taskId5, ownerId), /Database connection pool is unavailable/);

    // 10. Cross-owner claim prevention
    console.log("Test 10: Cross-owner claim prevention...");
    const taskIdCross = await store.createTask(ownerId, "Goal 10", profile.id);
    const planCross = {
    repoProfileId: profile.id,
    description: "Goal 10 plan",
    route: "mac",
    allowedPaths: ["src"],
    testCommand: { executable: "npm", args: ["test"] },
    deadline: Date.now() + 100000
  };
    await store.updateTaskPlan(taskIdCross, ownerId, planCross);
    const hashCross = hashPlan(planCross);
    await store.requestApproval(taskIdCross, ownerId);
    await store.approveTask(taskIdCross, ownerId, hashCross, route);

    const owner456 = "owner-456";
    const deviceCross = await store.registerDevice(owner456, "Cross Device");

    const eventsBeforeCross = await pool.query(`SELECT COUNT(*) FROM ghost_task_events WHERE task_id = $1`, [taskIdCross]);
    const leasesBeforeCross = await pool.query(`SELECT COUNT(*) FROM ghost_worker_leases WHERE task_id = $1`, [taskIdCross]);
    
    const crossClaim = await store.claimApprovedTask(deviceCross.deviceId, route);
    assert.strictEqual(crossClaim, null, "Cross-owner claim must return null");

    const eventsAfterCross = await pool.query(`SELECT COUNT(*) FROM ghost_task_events WHERE task_id = $1`, [taskIdCross]);
    const leasesAfterCross = await pool.query(`SELECT COUNT(*) FROM ghost_worker_leases WHERE task_id = $1`, [taskIdCross]);
    const statusAfterCross = await pool.query(`SELECT status FROM ghost_agent_tasks WHERE id = $1`, [taskIdCross]);

    assert.strictEqual(eventsBeforeCross.rows[0].count, eventsAfterCross.rows[0].count, "Event count must not change on cross-owner attempt");
    assert.strictEqual(leasesBeforeCross.rows[0].count, leasesAfterCross.rows[0].count, "Lease count must not change on cross-owner attempt");
    assert.strictEqual(statusAfterCross.rows[0].status, 'approved', "Task state must remain approved");

    const legitimateClaim = await store.claimApprovedTask(device1.deviceId, route);
    assert.ok(legitimateClaim !== null, "Legitimate owner device must still be able to claim the task");

    // 11. Secret value rejection in tasks/plans
    console.log("Test 11: Secret value rejection in tasks/plans...");
    const secretGoal = "Connect to postgres://admin:superSecretDBPass123@db.internal:5432/prod";
    const taskIdSecret = await store.createTask(ownerId, secretGoal, profile.id);

    const taskRow = await pool.query(`SELECT goal FROM ghost_agent_tasks WHERE id = $1`, [taskIdSecret]);
    const storedGoal = taskRow.rows[0].goal;
    assert.ok(!storedGoal.includes("superSecretDBPass123"), "Stored goal must not contain raw database password");
    assert.ok(storedGoal.includes("[REDACTED]"), "Stored goal must be redacted");

    const secretPlan = {
    repoProfileId: profile.id,
    description: "Goal secret plan",
    route: "mac",
    allowedPaths: ["src", "API_KEY=sk_live_98765xyz"],
    testCommand: { executable: "npm", args: ["test"] },
    deadline: Date.now() + 100000
  };
    await assertThrowsAsync(
      () => store.updateTaskPlan(taskIdSecret, ownerId, secretPlan),
      /Plan contains unsafe secret values and was rejected/,
      "Updating plan with secret values must fail-closed"
    );

    const planRow = await pool.query(`SELECT plan_json FROM ghost_agent_tasks WHERE id = $1`, [taskIdSecret]);
    assert.strictEqual(planRow.rows[0].plan_json, null, "Plan must remain unmodified/empty after failed update");

    
    // 12. Invalid plans, paths, shell metacharacters rejected
    console.log("Test 12: Invalid plan structures and paths...");
    const taskIdInvalid = await store.createTask(ownerId, "Invalid plans test", profile.id);
    
    // Invalid shape
    await assertThrowsAsync(
      () => store.updateTaskPlan(taskIdInvalid, ownerId, { repoProfileId: profile.id, badField: true }),
      /PolicyViolationError/,
      "Structurally invalid plan should be rejected"
    );

    // Unsafe path
    const unsafePlan = {
      repoProfileId: profile.id,
      description: "bad path",
      route: "mac",
      allowedPaths: ["../../etc/passwd"],
      testCommand: { executable: "npm", args: ["test"] },
      deadline: Date.now() + 100000
    };
    await assertThrowsAsync(
      () => store.updateTaskPlan(taskIdInvalid, ownerId, unsafePlan),
      /PolicyViolationError/,
      "Unsafe path should be rejected"
    );

    // Shell metacharacter
    const metaPlan = {
      ...unsafePlan,
      allowedPaths: ["src"],
      testCommand: { executable: "npm", args: ["test", ";", "rm", "-rf", "/"] }
    };
    await assertThrowsAsync(
      () => store.updateTaskPlan(taskIdInvalid, ownerId, metaPlan),
      /PolicyViolationError/,
      "Shell metacharacter should be rejected"
    );

    // Verify no changes occurred
    const checkInvalidTask = await pool.query(`SELECT plan_json, status FROM ghost_agent_tasks WHERE id = $1`, [taskIdInvalid]);
    assert.strictEqual(checkInvalidTask.rows[0].plan_json, null, "Plan should remain null");
    assert.strictEqual(checkInvalidTask.rows[0].status, 'draft', "Status should remain draft");
    
    // 13. Valid plan hash validation
    console.log("Test 13: Valid plan hash validation...");
    const validPlan = {
      repoProfileId: profile.id,
      description: "good plan",
      route: "mac",
      allowedPaths: ["src"],
      testCommand: { executable: "npm", args: ["test"] },
      deadline: Date.now() + 100000
    };
    await store.updateTaskPlan(taskIdInvalid, ownerId, validPlan);
    
    const expectedValidHash = hashPlan(validPlan);
    
    const validCheck = await pool.query(`SELECT plan_hash FROM ghost_agent_tasks WHERE id = $1`, [taskIdInvalid]);
    assert.strictEqual(validCheck.rows[0].plan_hash, expectedValidHash, "Stored hash must match canonical hashPlan output");

    // 14. Repo profile ownership cross-check
    console.log("Test 14: Repo profile ownership...");
    const eventsBeforeRepo = await pool.query(`SELECT COUNT(*) FROM ghost_task_events`);
    const tasksBeforeRepo = await pool.query(`SELECT COUNT(*) FROM ghost_agent_tasks`);
    
    await assertThrowsAsync(
      () => store.createTask("owner-456", "Try to steal profile", profile.id),
      /Unauthorized: Repo profile belongs to a different owner/,
      "Different owner cannot create task with owner-123's profile"
    );
    
    const eventsAfterRepo = await pool.query(`SELECT COUNT(*) FROM ghost_task_events`);
    const tasksAfterRepo = await pool.query(`SELECT COUNT(*) FROM ghost_agent_tasks`);
    assert.strictEqual(eventsBeforeRepo.rows[0].count, eventsAfterRepo.rows[0].count, "No events should be created");
    assert.strictEqual(tasksBeforeRepo.rows[0].count, tasksAfterRepo.rows[0].count, "No tasks should be created");

    const validTask = await store.createTask(ownerId, "My own profile", profile.id);
    assert.ok(validTask, "Owner-123 can create task with their own profile");

    
    // 15. Repo profile ID mismatch in plan
    console.log("Test 15: Repo profile ID mismatch in plan...");
    const taskIdProfileMismatch = await store.createTask(ownerId, "Profile mismatch test", profile.id);
    const mismatchPlan = {
      repoProfileId: "fake-profile-999",
      description: "Mismatch plan",
      route: "mac",
      allowedPaths: ["src"],
      testCommand: { executable: "npm", args: ["test"] },
      deadline: Date.now() + 100000
    };
    await assertThrowsAsync(
      () => store.updateTaskPlan(taskIdProfileMismatch, ownerId, mismatchPlan),
      /Repo profile mismatch in plan/,
      "Plan with wrong repoProfileId should be rejected"
    );
    const checkMismatch = await pool.query(`SELECT plan_json, status FROM ghost_agent_tasks WHERE id = $1`, [taskIdProfileMismatch]);
    assert.strictEqual(checkMismatch.rows[0].plan_json, null, "Plan should remain null");

    // 16. Route mismatch in approval
    console.log("Test 16: Route mismatch in approval...");
    const taskIdRouteMismatch = await store.createTask(ownerId, "Route mismatch test", profile.id);
    const routePlan = {
      repoProfileId: profile.id,
      description: "Route mismatch plan",
      route: "mac",
      allowedPaths: ["src"],
      testCommand: { executable: "npm", args: ["test"] },
      deadline: Date.now() + 100000
    };
    await store.updateTaskPlan(taskIdRouteMismatch, ownerId, routePlan);
    
    const routeHash = hashPlan(routePlan);
    await store.requestApproval(taskIdRouteMismatch, ownerId);
    
    await assertThrowsAsync(
      () => store.approveTask(taskIdRouteMismatch, ownerId, routeHash, "linux"),
      /Approval failed: Route mismatch/,
      "Approval with wrong route should fail"
    );
    const checkRoute = await pool.query(`SELECT status, route FROM ghost_agent_tasks WHERE id = $1`, [taskIdRouteMismatch]);
    assert.strictEqual(checkRoute.rows[0].status, 'awaiting_approval', "Status must remain awaiting_approval");
    assert.strictEqual(checkRoute.rows[0].route, null, "Route must remain null");

    // 17. Duplicate running transition
    console.log("Test 17: Duplicate running transition...");
    const taskIdDupRun = await store.createTask(ownerId, "Dup run test", profile.id);
    const dupPlan = {
      repoProfileId: profile.id,
      description: "Dup plan",
      route: "mac",
      allowedPaths: ["src"],
      testCommand: { executable: "npm", args: ["test"] },
      deadline: Date.now() + 100000
    };
    await store.updateTaskPlan(taskIdDupRun, ownerId, dupPlan);
    const dupHash = hashPlan(dupPlan);
    await store.requestApproval(taskIdDupRun, ownerId);
    await store.approveTask(taskIdDupRun, ownerId, dupHash, route);
    const claimDup = await store.claimApprovedTask(device1.deviceId, route);
    
    await store.updateTaskStateByWorker(taskIdDupRun, device1.deviceId, claimDup.leaseToken, 'running', {});
    const eventsBeforeDup = await pool.query(`SELECT COUNT(*) FROM ghost_task_events WHERE task_id = $1`, [taskIdDupRun]);
    
    await assertThrowsAsync(
      () => store.updateTaskStateByWorker(taskIdDupRun, device1.deviceId, claimDup.leaseToken, 'awaiting_review', {}),
      /Invalid state transition/,
      "Direct running to review should fail"
    );
    await assertThrowsAsync(
      () => store.updateTaskStateByWorker(taskIdDupRun, device1.deviceId, claimDup.leaseToken, 'running', {}),
      /Invalid state transition or task not found/,
      "Duplicate running transition should fail"
    );
    const eventsAfterDup = await pool.query(`SELECT COUNT(*) FROM ghost_task_events WHERE task_id = $1`, [taskIdDupRun]);
    assert.strictEqual(eventsBeforeDup.rows[0].count, eventsAfterDup.rows[0].count, "No extra event should be created");

    // 18. Cancellation-race safety
    console.log("Test 18: Cancellation-race safety...");
    const taskIdCancel = await store.createTask(ownerId, "Cancel test", profile.id);
    const planCancel = { ...validPlan, description: "cancel plan" };
    await store.updateTaskPlan(taskIdCancel, ownerId, planCancel);
    await store.requestApproval(taskIdCancel, ownerId);
    await store.approveTask(taskIdCancel, ownerId, hashPlan(planCancel), route);
    const claimCancel = await store.claimApprovedTask(device1.deviceId, route);
    
    await store.cancelTask(taskIdCancel, ownerId);
    
    const eventsBeforeCancelRace = await pool.query(`SELECT COUNT(*) FROM ghost_task_events WHERE task_id = $1`, [taskIdCancel]);
    const artifactsBeforeCancelRace = await pool.query(`SELECT COUNT(*) FROM ghost_task_artifacts WHERE task_id = $1`, [taskIdCancel]);
    const statusBeforeCancelRace = await pool.query(`SELECT status FROM ghost_agent_tasks WHERE id = $1`, [taskIdCancel]);

    await assertThrowsAsync(
      () => store.updateTaskStateByWorker(taskIdCancel, device1.deviceId, claimCancel.leaseToken, 'running', {}),
      /Invalid, expired, or cancelled lease/,
      "Worker transition should fail after cancellation"
    );
    
    await assertThrowsAsync(
      () => store.saveArtifact(taskIdCancel, device1.deviceId, claimCancel.leaseToken, {
        manifest: { file: "src/safe.js" },
        diffSummary: "test",
        diffHash: "hash123",
        testCommand: planCancel.testCommand,
        exitCode: 0,
        outputRedacted: "ok",
        status: "success"
      }),
      /Invalid, expired, or cancelled lease/,
      "Saving artifact should fail after cancellation"
    );

    const eventsAfterCancelRace = await pool.query(`SELECT COUNT(*) FROM ghost_task_events WHERE task_id = $1`, [taskIdCancel]);
    const artifactsAfterCancelRace = await pool.query(`SELECT COUNT(*) FROM ghost_task_artifacts WHERE task_id = $1`, [taskIdCancel]);
    const statusAfterCancelRace = await pool.query(`SELECT status FROM ghost_agent_tasks WHERE id = $1`, [taskIdCancel]);

    assert.strictEqual(eventsBeforeCancelRace.rows[0].count, eventsAfterCancelRace.rows[0].count, "Event count must remain unchanged");
    assert.strictEqual(artifactsBeforeCancelRace.rows[0].count, artifactsAfterCancelRace.rows[0].count, "Artifact count must remain unchanged");
    assert.strictEqual(statusBeforeCancelRace.rows[0].status, statusAfterCancelRace.rows[0].status, "Task state must remain unchanged");

    // 19. Immutable plan reapproval boundary
    console.log("Test 19: Immutable plan reapproval boundary...");
    const taskIdImmut = await store.createTask(ownerId, "Immut test", profile.id);
    const planImmut = { ...validPlan, description: "immut plan" };
    await store.updateTaskPlan(taskIdImmut, ownerId, planImmut);
    await store.requestApproval(taskIdImmut, ownerId);
    
    const eventsBeforeImmut = await pool.query(`SELECT COUNT(*) FROM ghost_task_events WHERE task_id = $1`, [taskIdImmut]);
    const taskBeforeImmut = await pool.query(`SELECT status, plan_hash FROM ghost_agent_tasks WHERE id = $1`, [taskIdImmut]);

    const alteredPlan = { ...planImmut, description: "hacked plan" };
    await assertThrowsAsync(
      () => store.updateTaskPlan(taskIdImmut, ownerId, alteredPlan),
      /Task not found or not in draft\/planned state/,
      "Altering plan after requestApproval must fail"
    );

    const eventsAfterImmut = await pool.query(`SELECT COUNT(*) FROM ghost_task_events WHERE task_id = $1`, [taskIdImmut]);
    const taskAfterImmut = await pool.query(`SELECT status, plan_hash FROM ghost_agent_tasks WHERE id = $1`, [taskIdImmut]);
    
    assert.strictEqual(eventsBeforeImmut.rows[0].count, eventsAfterImmut.rows[0].count, "Event count must remain unchanged");
    assert.strictEqual(taskBeforeImmut.rows[0].status, taskAfterImmut.rows[0].status, "Status must remain unchanged");
    assert.strictEqual(taskBeforeImmut.rows[0].plan_hash, taskAfterImmut.rows[0].plan_hash, "Stored plan hash must remain unchanged");

    // 20. Approved-plan evidence integrity
    console.log("Test 20: Approved-plan evidence integrity...");
    const taskIdEv = await store.createTask(ownerId, "Ev test", profile.id);
    const planEv = {
      repoProfileId: profile.id,
      description: "Ev plan",
      route: "mac",
      allowedPaths: ["src"],
      testCommand: { executable: "npm", args: ["test"] },
      deadline: Date.now() + 100000
    };
    await store.updateTaskPlan(taskIdEv, ownerId, planEv);
    await store.requestApproval(taskIdEv, ownerId);
    await store.approveTask(taskIdEv, ownerId, hashPlan(planEv), route);
    const claimEv = await store.claimApprovedTask(device1.deviceId, route);
    await store.updateTaskStateByWorker(taskIdEv, device1.deviceId, claimEv.leaseToken, 'running', {});
    
    // Wrong test command
    await assertThrowsAsync(
      () => store.saveArtifact(taskIdEv, device1.deviceId, claimEv.leaseToken, {
        manifest: { file: "src/safe.js" },
        diffSummary: "test",
        diffHash: "hash",
        testCommand: { executable: "echo", args: ["hacked"] },
        exitCode: 0,
        outputRedacted: "ok",
        status: "success"
      }),
      /Artifact test command does not match approved plan/,
      "Wrong test command should be rejected"
    );

    // Out-of-scope changed file
    await assertThrowsAsync(
      () => store.saveArtifact(taskIdEv, device1.deviceId, claimEv.leaseToken, {
        manifest: { file: "package.json" }, // Outside "src"
        diffSummary: "test",
        diffHash: "hash",
        testCommand: planEv.testCommand,
        exitCode: 0,
        outputRedacted: "ok",
        status: "success"
      }),
      /Artifact manifest contains out-of-scope paths or traversal/,
      "Out-of-scope path should be rejected"
    );

    // Traversal path
    await assertThrowsAsync(
      () => store.saveArtifact(taskIdEv, device1.deviceId, claimEv.leaseToken, {
        manifest: { file: "src/../package.json" },
        diffSummary: "test",
        diffHash: "hash",
        testCommand: planEv.testCommand,
        exitCode: 0,
        outputRedacted: "ok",
        status: "success"
      }),
      /Artifact manifest contains out-of-scope paths or traversal/,
      "Traversal path should be rejected"
    );

    // Valid artifact but failed execution
    await store.saveArtifact(taskIdEv, device1.deviceId, claimEv.leaseToken, {
      manifest: { file: "src/safe.js" },
      diffSummary: "test",
      diffHash: "hash123",
      testCommand: planEv.testCommand,
      exitCode: 1, // FAILED
      outputRedacted: "error",
      status: "failed"
    });
    await store.updateTaskStateByWorker(taskIdEv, device1.deviceId, claimEv.leaseToken, 'verifying', {});
    await store.updateTaskStateByWorker(taskIdEv, device1.deviceId, claimEv.leaseToken, 'awaiting_review', {});

    // Accept with failed artifact should be rejected
    await assertThrowsAsync(
      () => store.acceptTask(taskIdEv, ownerId),
      /No verified successful execution evidence exists/,
      "Failed artifact cannot be accepted"
    );

    // Now save a successful artifact
    await store.saveArtifact(taskIdEv, device1.deviceId, claimEv.leaseToken, {
      manifest: { file: "src/safe2.js" },
      diffSummary: "test2",
      diffHash: "hash456",
      testCommand: planEv.testCommand,
      exitCode: 0, // SUCCESS
      outputRedacted: "ok",
      status: "success"
    });
    
    // Accept should now pass
    await store.acceptTask(taskIdEv, ownerId);
    const checkAccepted = await pool.query(`SELECT status FROM ghost_agent_tasks WHERE id = $1`, [taskIdEv]);
    assert.strictEqual(checkAccepted.rows[0].status, 'accepted', "Task should be successfully accepted");

    console.log("✅ All DB integration tests passed successfully.");
  } catch (err) {
    console.error("❌ Test failed:", err);
    process.exitCode = 1;
  } finally {
    try {
      // Forcefully close the main pool to release any dangling locks from tests
      await pool.end();
      
      const dropPool = new pg.Pool({ connectionString: testDbUrl });
      console.log(`[Integration Test] Dropping temporary schema: ${schemaName}`);
      await dropPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      const schemaCheck = await dropPool.query(`SELECT nspname FROM pg_namespace WHERE nspname = $1`, [schemaName]);
      if (schemaCheck.rowCount > 0) {
        throw new Error(`Schema ${schemaName} still exists after drop attempt!`);
      }
      console.log(`[Integration Test] Verified schema absent: ${schemaName}`);
      await dropPool.end();
    } catch (e) {
      console.error("Cleanup failed:", e);
      process.exitCode = 1;
    }
  }
}

runTests();

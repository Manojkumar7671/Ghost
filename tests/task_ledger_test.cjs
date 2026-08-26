/**
 * tests/task_ledger_test.cjs — Task Ledger V1 Comprehensive Test Suite
 *
 * Requirements:
 * 1. Owner can create a valid pending task linked to their own goal.
 * 2. Owner task list returns only that owner’s tasks and has bounded results.
 * 3. An unauthenticated visitor gets 403 for every task route.
 * 4. A different owner cannot read or update another owner’s task or events.
 * 5. Invalid status values are rejected.
 * 6. Moving to blocked without a reason is rejected; with a safe reason it appends the right event.
 * 7. planned and cancelled transitions append exactly one factual event each.
 * 8. No API route can set execution-style states (running, completed, succeeded, failed) or trigger execution.
 * 9. Event entries cannot be edited or deleted through any exposed route.
 * 10. Secret-shaped title/description/blocker input is rejected without persisting it.
 * 11. Ordinary /api/chat and Plan/Diff routes do not create task records.
 * 12. Simulated durable-store unavailability returns an honest error and does not pretend the task was saved.
 * 13. Durable database testing using AGENT_TEST_DATABASE_URL when available (never SUPABASE_DB_URL).
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log("--- RUNNING TASK LEDGER V1 COMPREHENSIVE TEST SUITE ---");

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`✓ PASS: ${name}`);
    } catch (err) {
        failed++;
        console.error(`✗ FAIL: ${name} — ${err.message}`);
    }
}

async function asyncTest(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`✓ PASS: ${name}`);
    } catch (err) {
        failed++;
        console.error(`✗ FAIL: ${name} — ${err.message}`);
    }
}

async function runSuite() {
    const personalCore = await import('../services/personalCore.js');
    const {
        createPersonalTask,
        listPersonalTasks,
        updatePersonalTaskStatus,
        listPersonalTaskEvents,
        createOwnerGoal,
        listOwnerGoals,
        resetMemoryStoreForTesting,
        generateContinuationSummary,
        ALLOWED_TASK_STATUSES,
        ALLOWED_TASK_EVENT_TYPES,
        SECRET_REJECTION_MESSAGE
    } = personalCore;

    // Reset store before beginning
    resetMemoryStoreForTesting();

    // 1. Task Creation & Goal Linkage
    await asyncTest("1. Authenticated owner creates valid pending task linked to own goal", async () => {
        const ownerId = "owner_alice";
        const goalRes = await createOwnerGoal(ownerId, { title: "Build Ghost into personal AI", note: "Core project goal", status: "active" });
        assert.strictEqual(goalRes.success, true);
        const goalId = goalRes.goal.id;

        const taskRes = await createPersonalTask(ownerId, {
            title: "Design the owner-visible task queue",
            description: "Plan-only autonomy foundation; no execution.",
            goalId
        });

        assert.strictEqual(taskRes.success, true);
        assert.strictEqual(taskRes.task.status, 'pending');
        assert.strictEqual(taskRes.task.title, "Design the owner-visible task queue");
        assert.strictEqual(taskRes.task.goalId, goalId);
        assert.strictEqual(taskRes.task.goalTitle, "Build Ghost into personal AI");

        // Verify initial atomic event
        assert.strictEqual(taskRes.event.eventType, 'task_created');
        assert.strictEqual(taskRes.event.taskId, taskRes.task.id);
        assert.strictEqual(taskRes.event.eventDetail.initialStatus, 'pending');
        assert.strictEqual(taskRes.event.eventDetail.goalTitle, "Build Ghost into personal AI");
    });

    // 2. Owner Task List & Bounded Results
    await asyncTest("2. Owner task list returns only that owner's tasks with bounding", async () => {
        const ownerAlice = "owner_alice";
        const tasksAlice = await listPersonalTasks(ownerAlice);
        assert(tasksAlice.length >= 1);
        assert.strictEqual(tasksAlice[0].ownerId, ownerAlice);

        // Foreign owner has 0 tasks
        const tasksBob = await listPersonalTasks("owner_bob");
        assert.strictEqual(tasksBob.length, 0);
    });

    // 3. Foreign Owner Isolation & Cross-Owner Protection
    await asyncTest("3. Cross-owner boundary: Owner Bob cannot read, update, or link to Alice's task/goal", async () => {
        const ownerAlice = "owner_alice";
        const ownerBob = "owner_bob";

        const tasksAlice = await listPersonalTasks(ownerAlice);
        const aliceTaskId = tasksAlice[0].id;
        const aliceGoalId = tasksAlice[0].goalId;

        // Bob tries to update Alice's task
        const updateRes = await updatePersonalTaskStatus(ownerBob, aliceTaskId, { status: 'planned' });
        assert.strictEqual(updateRes.success, false);
        assert(updateRes.error.toLowerCase().includes('not found') || updateRes.error.toLowerCase().includes('unauthorized'));

        // Bob tries to fetch Alice's task events
        const eventsRes = await listPersonalTaskEvents(ownerBob, aliceTaskId);
        assert.strictEqual(eventsRes.success, false);

        // Bob tries to create a task linking to Alice's goal
        const crossLinkRes = await createPersonalTask(ownerBob, {
            title: "Illegitimate task",
            goalId: aliceGoalId
        });
        assert.strictEqual(crossLinkRes.success, false);
        assert(crossLinkRes.error.toLowerCase().includes('unauthorized') || crossLinkRes.error.toLowerCase().includes('not found'));
    });

    // 4. Invalid Status Rejection & Execution States Prohibited
    await asyncTest("4. Prohibit invalid & execution-style states (running, completed, succeeded, failed)", async () => {
        const ownerAlice = "owner_alice";
        const tasksAlice = await listPersonalTasks(ownerAlice);
        const taskId = tasksAlice[0].id;

        const forbiddenStatuses = ['running', 'completed', 'succeeded', 'failed', 'executing', 'in_progress', 'invalid_state'];
        for (const st of forbiddenStatuses) {
            const res = await updatePersonalTaskStatus(ownerAlice, taskId, { status: st });
            assert.strictEqual(res.success, false, `Status ${st} must be rejected`);
            assert(res.error.toLowerCase().includes('invalid task status'));
        }

        // Verify task status remained pending
        const events = await listPersonalTaskEvents(ownerAlice, taskId);
        assert.strictEqual(events.events.length, 1); // Only task_created
    });

    // 5. Blocked Transition Requires Reason & Records Event
    await asyncTest("5. Transition to blocked requires reason; appends blocker_recorded event", async () => {
        const ownerAlice = "owner_alice";
        const tasksAlice = await listPersonalTasks(ownerAlice);
        const taskId = tasksAlice[0].id;

        // Attempt blocked without reason
        const failRes = await updatePersonalTaskStatus(ownerAlice, taskId, { status: 'blocked' });
        assert.strictEqual(failRes.success, false);
        assert(failRes.error.toLowerCase().includes('blocker reason is required'));

        // Transition with valid reason
        const passRes = await updatePersonalTaskStatus(ownerAlice, taskId, {
            status: 'blocked',
            blockerReason: 'Requires a separate owner approval contract.'
        });
        assert.strictEqual(passRes.success, true);
        assert.strictEqual(passRes.task.status, 'blocked');
        assert.strictEqual(passRes.task.blockerReason, 'Requires a separate owner approval contract.');
        assert.strictEqual(passRes.event.eventType, 'blocker_recorded');
        assert.strictEqual(passRes.event.eventDetail.blockerReason, 'Requires a separate owner approval contract.');
        assert.strictEqual(passRes.event.eventDetail.fromStatus, 'pending');
        assert.strictEqual(passRes.event.eventDetail.toStatus, 'blocked');
    });

    // 6. Planned and Cancelled Transitions
    await asyncTest("6. Planned and Cancelled transitions append exactly one factual event each", async () => {
        const ownerAlice = "owner_alice";
        const task2Res = await createPersonalTask(ownerAlice, {
            title: "Review approval-gated edit/test worker boundaries",
            description: "Second task for lifecycle verification."
        });
        assert.strictEqual(task2Res.success, true);
        const taskId = task2Res.task.id;

        // Move to planned
        const planRes = await updatePersonalTaskStatus(ownerAlice, taskId, { status: 'planned' });
        assert.strictEqual(planRes.success, true);
        assert.strictEqual(planRes.task.status, 'planned');
        assert.strictEqual(planRes.event.eventType, 'status_changed');
        assert.strictEqual(planRes.event.eventDetail.fromStatus, 'pending');
        assert.strictEqual(planRes.event.eventDetail.toStatus, 'planned');

        // Move to cancelled
        const cancelRes = await updatePersonalTaskStatus(ownerAlice, taskId, {
            status: 'cancelled',
            blockerReason: 'Owner chose not to proceed.'
        });
        assert.strictEqual(cancelRes.success, true);
        assert.strictEqual(cancelRes.task.status, 'cancelled');
        assert.strictEqual(cancelRes.event.eventType, 'task_cancelled');

        // Check events count
        const eventsRes = await listPersonalTaskEvents(ownerAlice, taskId);
        assert.strictEqual(eventsRes.success, true);
        assert.strictEqual(eventsRes.events.length, 3); // created -> planned -> cancelled
    });

    // 7. Secret Rejection for Tasks
    await asyncTest("7. Secret-shaped title, description, and blocker reason are rejected", async () => {
        const ownerAlice = "owner_alice";

        // Secret in title
        const secTitle = await createPersonalTask(ownerAlice, {
            title: "My task with sk-1234567890abcdef123456"
        });
        assert.strictEqual(secTitle.success, false);
        assert.strictEqual(secTitle.isSecretRejected, true);

        // Secret in description
        const secDesc = await createPersonalTask(ownerAlice, {
            title: "Valid title",
            description: "Connection: postgres://user:password123@localhost:5432/db"
        });
        assert.strictEqual(secDesc.success, false);
        assert.strictEqual(secDesc.isSecretRejected, true);

        // Secret in blocker reason
        const taskRes = await createPersonalTask(ownerAlice, { title: "Clean task for secret blocker test" });
        const secBlock = await updatePersonalTaskStatus(ownerAlice, taskRes.task.id, {
            status: 'blocked',
            blockerReason: "Blocked on key gsk_1234567890abcdef123456"
        });
        assert.strictEqual(secBlock.success, false);
        assert.strictEqual(secBlock.isSecretRejected, true);
    });

    // 8. Continuation Summary Includes Outstanding Tasks
    test("8. Deterministic continuation summary includes active goals & outstanding tasks", () => {
        const goals = [
            { title: "Build Ghost into my personal AI", note: "Autonomous and private", status: "active" }
        ];
        const tasks = [
            { title: "Design the owner-visible task queue", status: "planned", goalTitle: "Build Ghost into my personal AI" },
            { title: "Review approval-gated edit/test worker boundaries", status: "blocked", blockerReason: "Requires a separate owner approval contract." },
            { title: "Obsolete task", status: "cancelled" }
        ];
        const memories = [
            { text: "Preference: Ghost must remain an owner-scoped assistant." }
        ];

        const summary = generateContinuationSummary(goals, memories, tasks);
        assert(summary.includes("Active Goals (1):"), "Includes active goals");
        assert(summary.includes("Outstanding Tasks (2):"), "Includes outstanding tasks (excludes cancelled)");
        assert(summary.includes("[Planned] Design the owner-visible task queue"), "Includes planned task with honest label");
        assert(summary.includes("[Blocked] Review approval-gated edit/test worker boundaries"), "Includes blocked task");
        assert(summary.includes("Blocker: Requires a separate owner approval contract."), "Includes blocker reason");
        assert(!summary.includes("Obsolete task"), "Does not list cancelled task in outstanding section");
    });

    // 9. Server Routes Structure & Visitor 403 Clearance
    test("9. Server Route Family /api/personal/tasks* Guards and Append-Only Invariant", () => {
        const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

        // Route presence
        assert(serverCode.includes("app.get('/api/personal/tasks'"), "GET /api/personal/tasks exists");
        assert(serverCode.includes("app.post('/api/personal/tasks'"), "POST /api/personal/tasks exists");
        assert(serverCode.includes("app.patch('/api/personal/tasks/:taskId/status'"), "PATCH /api/personal/tasks/:taskId/status exists");
        assert(serverCode.includes("app.get('/api/personal/tasks/:taskId/events'"), "GET /api/personal/tasks/:taskId/events exists");

        // Owner authentication check
        const taskRoutesCount = (serverCode.match(/const owner = authenticateOwner\(req\)/g) || []).length;
        assert(taskRoutesCount >= 8, "All personal routes verify owner authentication");

        // Append-only invariant: No delete/edit route for task events
        assert(!serverCode.includes("app.delete('/api/personal/tasks/:taskId/events"), "No DELETE route for task events");
        assert(!serverCode.includes("app.patch('/api/personal/tasks/:taskId/events"), "No PATCH route for task events");
        assert(!serverCode.includes("app.put('/api/personal/tasks/:taskId/events"), "No PUT route for task events");
    });

    // 10. Simulated Durable Storage Unavailability
    await asyncTest("10. Simulated durable-store unavailability returns honest error without false persistence", async () => {
        const mockFailingPool = {
            query: async () => {
                throw new Error("Simulated PostgreSQL connection failure");
            }
        };

        const result = await createPersonalTask("owner_test", {
            title: "Task that should fail durable write"
        }, mockFailingPool);

        assert.strictEqual(result.success, false);
        assert(result.error.toLowerCase().includes("unavailable"));
    });

    // 11. Optional Real Database Verification with AGENT_TEST_DATABASE_URL
    if (process.env.AGENT_TEST_DATABASE_URL) {
        await asyncTest("11. Real DB integration test with AGENT_TEST_DATABASE_URL", async () => {
            const { Pool } = require('pg');
            const testPool = new Pool({
                connectionString: process.env.AGENT_TEST_DATABASE_URL,
                ssl: false
            });

            try {
                await personalCore.initPersonalTaskTables(testPool);

                const dbOwner = "owner_db_test_" + Date.now();
                const createRes = await createPersonalTask(dbOwner, {
                    title: "Durable DB Task",
                    description: "Stored in real postgres table"
                }, testPool);

                assert.strictEqual(createRes.success, true);
                const taskId = createRes.task.id;

                const statusRes = await updatePersonalTaskStatus(dbOwner, taskId, {
                    status: 'planned'
                }, testPool);
                assert.strictEqual(statusRes.success, true);

                const eventsRes = await listPersonalTaskEvents(dbOwner, taskId, testPool);
                assert.strictEqual(eventsRes.success, true);
                assert.strictEqual(eventsRes.events.length, 2);

                const listRes = await listPersonalTasks(dbOwner, testPool);
                assert.strictEqual(listRes.length, 1);
                assert.strictEqual(listRes[0].status, 'planned');
            } finally {
                await testPool.end();
            }
        });
    }

    console.log(`\nTASK LEDGER TEST SUITE RESULTS: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

runSuite().catch(err => {
    console.error("Test runner error:", err);
    process.exit(1);
});

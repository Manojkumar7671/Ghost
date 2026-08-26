/**
 * tests/personal_core_test.cjs — Personal Core V1 Test Suite
 *
 * Validates:
 * 1. Zero execution primitives in Personal Core service.
 * 2. Secret-rejection and bounding rules for memories.
 * 3. CRUD operations for explicit memories and owner goals.
 * 4. Deterministic continuation summary logic.
 * 5. Strict owner isolation and multi-owner scoping.
 * 6. Server route protection and visitor 403 enforcement.
 * 7. Client UI safety and safe text rendering.
 * 8. Plan/Diff and Voice non-regression checks.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log("--- RUNNING PERSONAL CORE V1 COMPREHENSIVE TEST SUITE ---");

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

async function runTests() {
    // 1. Static AST / Code Inspection: Zero Execution Primitives
    test("Zero Execution Primitives in Personal Core Service", () => {
        const coreCode = fs.readFileSync(path.join(__dirname, '../services/personalCore.js'), 'utf8');
        const forbiddenPatterns = [
            /child_process/,
            /\bexec\s*\(/,
            /\bexecSync\s*\(/,
            /\bspawn\s*\(/,
            /\bfork\s*\(/,
            /\bwriteFile\s*\(/,
            /\bwriteFileSync\s*\(/,
            /\bunlink\s*\(/,
            /\bunlinkSync\s*\(/,
            /\brmSync\s*\(/,
            /\/api\/agent\b/
        ];
        for (const pattern of forbiddenPatterns) {
            assert(!pattern.test(coreCode), `PersonalCore must not contain forbidden primitive: ${pattern}`);
        }
    });

    // 2. Secret Detection & Rejection
    await asyncTest("Secret Detection and Rejection for Memories and Goals", async () => {
        const { isPotentialSecret, saveExplicitMemory, createOwnerGoal, SECRET_REJECTION_MESSAGE, resetMemoryStoreForTesting } = await import('../services/personalCore.js');
        resetMemoryStoreForTesting();

        const secrets = [
            "sk-1234567890abcdef123456",
            "gsk_abcdef1234567890abcdef",
            "AIzaSyD1234567890abcdef1234567890",
            "ghp_1234567890abcdef1234567890",
            "github_pat_11AAAAAAA_1234567890abcdef",
            "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
            "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...",
            "postgres://user:super_secret_pw@db.supabase.com:5432/main",
            "api_key=my_super_secret_token_value_12345"
        ];

        for (const sec of secrets) {
            assert(isPotentialSecret(sec), `Secret pattern failed to match: ${sec}`);
            const memRes = await saveExplicitMemory('owner_1', { text: `My note: ${sec}` });
            assert.strictEqual(memRes.success, false, `Memory with secret must be rejected: ${sec}`);
            assert.strictEqual(memRes.error, SECRET_REJECTION_MESSAGE);

            const goalRes = await createOwnerGoal('owner_1', { title: `Goal: ${sec}` });
            assert.strictEqual(goalRes.success, false, `Goal with secret must be rejected: ${sec}`);
            assert.strictEqual(goalRes.error, SECRET_REJECTION_MESSAGE);
        }

        // Safe normal text must not be flagged
        const safeTexts = [
            "Remember to review the auth middleware tomorrow.",
            "Decision: use PostgreSQL for structured persistence and keep memory explicit.",
            "Client prefers dark Graphite theme with high contrast borders."
        ];
        for (const safe of safeTexts) {
            assert(!isPotentialSecret(safe), `Safe text falsely flagged as secret: ${safe}`);
        }
    });

    // 3. Memory CRUD Operations & Bounding
    await asyncTest("Memory Creation, Listing, Bounding, and Deletion", async () => {
        const { saveExplicitMemory, listExplicitMemories, deleteExplicitMemory, resetMemoryStoreForTesting } = await import('../services/personalCore.js');
        resetMemoryStoreForTesting();

        // Empty rejection
        const emptyRes = await saveExplicitMemory('owner_1', { text: '' });
        assert.strictEqual(emptyRes.success, false);

        // Safe creation
        const saveRes = await saveExplicitMemory('owner_1', { text: 'Owner preference: Dark Mode.' });
        assert.strictEqual(saveRes.success, true);
        assert(saveRes.memory && saveRes.memory.id);
        assert.strictEqual(saveRes.memory.text, 'Owner preference: Dark Mode.');

        // Listing
        const list = await listExplicitMemories('owner_1');
        assert.strictEqual(list.length, 1);
        assert.strictEqual(list[0].id, saveRes.memory.id);

        // Deletion
        const delRes = await deleteExplicitMemory('owner_1', saveRes.memory.id);
        assert.strictEqual(delRes.success, true);

        const listAfter = await listExplicitMemories('owner_1');
        assert.strictEqual(listAfter.length, 0);
    });

    // 4. Goal Creation, Status Updates, and Deletion
    await asyncTest("Goal Lifecycle and Status Validation", async () => {
        const { createOwnerGoal, listOwnerGoals, updateOwnerGoal, deleteOwnerGoal, resetMemoryStoreForTesting } = await import('../services/personalCore.js');
        resetMemoryStoreForTesting();

        // Create goal
        const goalRes = await createOwnerGoal('owner_1', {
            title: 'Ship Personal Core V1',
            note: 'Build explicit memory, goals, and continuity summary',
            status: 'active'
        });
        assert.strictEqual(goalRes.success, true);
        assert(goalRes.goal && goalRes.goal.id);
        assert.strictEqual(goalRes.goal.status, 'active');

        // Status update
        const updateRes = await updateOwnerGoal('owner_1', goalRes.goal.id, { status: 'done' });
        assert.strictEqual(updateRes.success, true);
        assert.strictEqual(updateRes.goal.status, 'done');

        // Invalid status rejection
        const invalidStatusRes = await updateOwnerGoal('owner_1', goalRes.goal.id, { status: 'destroyed' });
        assert.strictEqual(invalidStatusRes.success, false);

        // Deletion
        const delRes = await deleteOwnerGoal('owner_1', goalRes.goal.id);
        assert.strictEqual(delRes.success, true);

        const listAfter = await listOwnerGoals('owner_1');
        assert.strictEqual(listAfter.length, 0);
    });

    // 5. Deterministic Continuation Summary
    test("Deterministic Continuation Summary Generation", () => {
        const { generateContinuationSummary } = require('../services/personalCore.js');

        // Empty state
        const emptySummary = generateContinuationSummary([], []);
        assert(emptySummary.includes("No saved context yet"), "Empty summary must state no saved context");

        // Active goals + memories
        const goals = [
            { id: '1', title: 'Refactor UI', note: 'Graphite consistency', status: 'active' },
            { id: '2', title: 'Legacy Cleanup', note: '', status: 'paused' }
        ];
        const memories = [
            { id: 'm1', text: 'Prefers strict TypeScript.' },
            { id: 'm2', text: 'Database is on local port 5432.' }
        ];

        const summary = generateContinuationSummary(goals, memories);
        assert(summary.includes("Active Goals (1):"), "Summary must include active goals");
        assert(summary.includes("[Active] Refactor UI — Note: Graphite consistency"));
        assert(summary.includes("Recent Explicit Memories (2):"));
        assert(summary.includes("Prefers strict TypeScript."));
        assert(!summary.includes("executed"), "Summary must never claim execution");
    });

    // 6. Owner Scoping & Isolation
    await asyncTest("Owner Isolation (Multi-Tenant Safety)", async () => {
        const { saveExplicitMemory, listExplicitMemories, createOwnerGoal, listOwnerGoals, deleteExplicitMemory, resetMemoryStoreForTesting } = await import('../services/personalCore.js');
        resetMemoryStoreForTesting();

        await saveExplicitMemory('owner_A', { text: 'Owner A secret idea (not an API key)' });
        await createOwnerGoal('owner_A', { title: 'Owner A Goal', status: 'active' });

        // Owner B must see nothing
        const listMemB = await listExplicitMemories('owner_B');
        assert.strictEqual(listMemB.length, 0, "Owner B must not see Owner A memories");

        const listGoalsB = await listOwnerGoals('owner_B');
        assert.strictEqual(listGoalsB.length, 0, "Owner B must not see Owner A goals");

        // Owner B cannot delete Owner A memory
        const memA = (await listExplicitMemories('owner_A'))[0];
        const delRes = await deleteExplicitMemory('owner_B', memA.id);
        assert.strictEqual(delRes.success, false, "Owner B cannot delete Owner A memory");
    });

    // 7. Server Route Wiring & Guard Verification
    test("Server Route Family /api/personal/* Authorization Guards", () => {
        const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
        const requiredRoutes = [
            "app.get('/api/personal/overview'",
            "app.get('/api/personal/memories'",
            "app.post('/api/personal/memories'",
            "app.delete('/api/personal/memories/:id'",
            "app.get('/api/personal/goals'",
            "app.post('/api/personal/goals'",
            "app.patch('/api/personal/goals/:id'",
            "app.delete('/api/personal/goals/:id'"
        ];

        for (const route of requiredRoutes) {
            assert(serverCode.includes(route), `Server must mount route: ${route}`);
        }
        assert(serverCode.includes("const owner = authenticateOwner(req)"), "Routes authenticate owner via authenticateOwner");
        assert(serverCode.includes("status(403).json({ success: false, error: 'Forbidden: Owner clearance required.' })"), "Routes enforce 403 on non-owner");
    });

    // 8. Client UI Integration & Plan/Diff / Voice Invariance
    test("Client UI Personal Core Controls and Invariance", () => {
        const htmlCode = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
        assert(htmlCode.includes('id="navPersonalCoreBtn"'), "index.html includes navPersonalCoreBtn");
        assert(htmlCode.includes('id="personalCoreModal"'), "index.html includes personalCoreModal");
        assert(htmlCode.includes('Do not save passwords, API keys, or other secrets'), "index.html includes security warning");

        const uiCode = fs.readFileSync(path.join(__dirname, '../public/ghost-ui.js'), 'utf8');
        assert(uiCode.includes('loadPersonalOverview'), "ghost-ui.js includes loadPersonalOverview");
        assert(uiCode.includes('renderGoalsList'), "ghost-ui.js includes renderGoalsList");
        assert(uiCode.includes('renderMemoriesList'), "ghost-ui.js includes renderMemoriesList");
        assert(uiCode.includes('renderProposedTaskCard'), "ghost-ui.js includes renderProposedTaskCard");
        assert(uiCode.includes('PLAN ONLY — NO FILES CHANGED — NO COMMANDS EXECUTED — APPROVAL REQUIRED FOR ANY FUTURE EDIT OR TEST'), "Plan/Diff banner remains intact");
    });

    // 9. Chat-First Task Memory V0: Deterministic Intent, Proposal Lifecycle & Boundaries
    await asyncTest("Chat-First Task Memory V0: Proposal Lifecycle and Safety Boundaries", async () => {
        const {
            parseTaskMemoryIntent,
            createTaskProposal,
            confirmTaskProposal,
            dismissTaskProposal,
            listPersonalTasks,
            listPersonalTaskEvents,
            resetMemoryStoreForTesting,
            resetTaskProposalsForTesting,
            SECRET_REJECTION_MESSAGE
        } = await import('../services/personalCore.js');

        resetMemoryStoreForTesting();
        resetTaskProposalsForTesting();

        const ownerId = "owner_test_task";

        // 1. Explicit owner request returns a proposal but creates NO durable task before confirmation
        const parsed = parseTaskMemoryIntent("Remember that I need to finish my résumé this week");
        assert.ok(parsed, "Explicit directive must match");
        assert.strictEqual(parsed.title, "Finish my résumé this week");

        const propRes = await createTaskProposal(ownerId, { text: "Remember that I need to finish my résumé this week" });
        assert.strictEqual(propRes.success, true);
        assert.ok(propRes.proposal.proposalId.startsWith('tprop_'));
        assert.strictEqual(propRes.proposal.title, "Finish my résumé this week");
        assert.strictEqual(propRes.proposal.state, 'proposed');

        // Check that 0 tasks exist in Personal Core prior to confirmation
        const tasksPreConfirm = await listPersonalTasks(ownerId);
        assert.strictEqual(tasksPreConfirm.length, 0, "No durable task created before confirmation");

        // 2. Valid owner confirmation creates exactly one pending task and yields task_created ledger evidence
        const confirmRes = await confirmTaskProposal(ownerId, propRes.proposal.proposalId);
        assert.strictEqual(confirmRes.success, true);
        assert.strictEqual(confirmRes.task.status, 'pending');
        assert.strictEqual(confirmRes.task.title, "Finish my résumé this week");
        assert(confirmRes.message.includes("No code, tools, or automated actions have been executed"));

        const tasksPostConfirm = await listPersonalTasks(ownerId);
        assert.strictEqual(tasksPostConfirm.length, 1, "Exactly one durable task created");
        assert.strictEqual(tasksPostConfirm[0].status, 'pending');

        const events = await listPersonalTaskEvents(ownerId, confirmRes.task.id);
        assert.strictEqual(events.events.length, 1);
        assert.strictEqual(events.events[0].eventType, 'task_created');

        // 3. Duplicate confirmation fails closed and creates no second task
        const doubleConfirm = await confirmTaskProposal(ownerId, propRes.proposal.proposalId);
        assert.strictEqual(doubleConfirm.success, false);
        assert.strictEqual(doubleConfirm.reasonCode, 'PROPOSAL_EXPIRED_OR_NOT_FOUND');
        const tasksPostDouble = await listPersonalTasks(ownerId);
        assert.strictEqual(tasksPostDouble.length, 1, "No duplicate task created");

        // 4. Dismiss deletes the proposal and creates no task
        const propDismiss = await createTaskProposal(ownerId, { text: "Remember to call the electrician" });
        assert.strictEqual(propDismiss.success, true);
        const dismissRes = await dismissTaskProposal(ownerId, propDismiss.proposal.proposalId);
        assert.strictEqual(dismissRes.success, true);
        assert.strictEqual(dismissRes.message, "Nothing was saved.");

        const confirmAfterDismiss = await confirmTaskProposal(ownerId, propDismiss.proposal.proposalId);
        assert.strictEqual(confirmAfterDismiss.success, false);
        assert.strictEqual(confirmAfterDismiss.reasonCode, 'PROPOSAL_EXPIRED_OR_NOT_FOUND');

        // 5. Wrong-owner confirmation fails closed without consuming the valid owner's proposal
        const propWrongOwner = await createTaskProposal(ownerId, { text: "Remember to update website" });
        assert.strictEqual(propWrongOwner.success, true);

        const foreignConfirm = await confirmTaskProposal("foreign_owner", propWrongOwner.proposal.proposalId);
        assert.strictEqual(foreignConfirm.success, false);
        assert.strictEqual(foreignConfirm.reasonCode, 'PROPOSAL_EXPIRED_OR_NOT_FOUND');

        // Legitimate owner can still confirm
        const legitConfirm = await confirmTaskProposal(ownerId, propWrongOwner.proposal.proposalId);
        assert.strictEqual(legitConfirm.success, true);

        // 6. Expired or restart-missing proposal fails closed
        resetTaskProposalsForTesting(); // simulates memory wipe on restart
        const confirmWiped = await confirmTaskProposal(ownerId, "tprop_nonexistent");
        assert.strictEqual(confirmWiped.success, false);
        assert.strictEqual(confirmWiped.reasonCode, 'PROPOSAL_EXPIRED_OR_NOT_FOUND');

        // 7. Casual/vague/non-owner chat does not generate a task proposal
        const casualInputs = [
            "What time is it?",
            "How does React work?",
            "Can you explain async/await?",
            "Maybe someday I'll write a book.",
            "I remember when computers had floppy disks."
        ];
        for (const input of casualInputs) {
            assert.strictEqual(parseTaskMemoryIntent(input), null, `Casual input must not trigger task intent: ${input}`);
        }

        // 8. Safe placeholder secret-pattern test rejects without echo and creates neither task nor proposal
        const secretInputs = [
            "Remember to save my key sk-1234567890abcdef123456",
            "Remember that I need to use ghp_1234567890abcdef1234567890",
            "Add a task: postgres://user:secretpass@db.local:5432/main"
        ];
        for (const secInput of secretInputs) {
            const secProposal = await createTaskProposal(ownerId, { text: secInput });
            assert.strictEqual(secProposal.success, false);
            assert.strictEqual(secProposal.error, SECRET_REJECTION_MESSAGE);
            assert.strictEqual(secProposal.isSecretRejected, true);
        }

        // 9. All user-facing success messages clearly state no execution occurred
        assert(confirmRes.message.includes("No code, tools, or automated actions have been executed."));
    });

    // 10. Chat-First Task Memory V0: Canonical Owner Identity Alignment Contract
    test("Chat-First Task Memory V0: Canonical Owner Identity Alignment Contract", () => {
        const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

        // Extract /api/chat handler block
        const chatRouteMatch = serverCode.match(/app\.post\('\/api\/chat'[\s\S]*?\napp\./);
        assert.ok(chatRouteMatch, "server.js must define app.post('/api/chat')");
        const chatRouteCode = chatRouteMatch[0];

        // 1 & 2: Verify canonical authenticateOwner(req) is used for proposal creation in /api/chat
        assert.ok(
            chatRouteCode.includes('const chatOwner = authenticateOwner(req);') ||
            chatRouteCode.includes('authenticateOwner(req)'),
            "/api/chat Task Memory proposal path must derive identity via authenticateOwner(req)"
        );
        assert.ok(
            chatRouteCode.includes('createTaskProposal(chatOwner.ownerId,') ||
            chatRouteCode.includes('createTaskProposal(owner.ownerId,'),
            "createTaskProposal in /api/chat must receive canonical owner.ownerId"
        );

        // 3: Verify proposal ownership does NOT fall back to client-controlled/display variables
        const proposalCallMatch = chatRouteCode.match(/createTaskProposal\(([^,\)]+)/);
        assert.ok(proposalCallMatch, "createTaskProposal call must exist in /api/chat");
        const ownerArg = proposalCallMatch[1].trim();
        assert.ok(
            !ownerArg.includes('safeUser') &&
            !ownerArg.includes('masterUser') &&
            !ownerArg.includes('req.body') &&
            !ownerArg.includes('req.user.username'),
            `createTaskProposal ownership argument (${ownerArg}) must not fall back to client/display values`
        );

        // 4: Verify confirm-proposal route uses the identical canonical authenticateOwner helper
        const confirmRouteMatch = serverCode.match(/app\.post\('\/api\/personal\/tasks\/confirm-proposal'[\s\S]*?\n\}\);/);
        assert.ok(confirmRouteMatch, "server.js must define app.post('/api/personal/tasks/confirm-proposal')");
        const confirmRouteCode = confirmRouteMatch[0];

        assert.ok(
            confirmRouteCode.includes('const owner = authenticateOwner(req);') ||
            confirmRouteCode.includes('authenticateOwner(req)'),
            "confirm-proposal route must authenticate via authenticateOwner(req)"
        );
        assert.ok(
            confirmRouteCode.includes('confirmTaskProposal(owner.ownerId,'),
            "confirmTaskProposal must receive canonical owner.ownerId"
        );
    });

    console.log(`\nPERSONAL CORE V1 TEST SUITE RESULTS: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

runTests().catch(err => {
    console.error("Test runner error:", err);
    process.exit(1);
});

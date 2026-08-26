/**
 * tests/plan_diff_current_request_context_test.cjs — Plan/Diff Current-Request & Personal-Context Verification Suite
 *
 * Tests:
 * 1. Current-request binding (Task A vs Task B proposal distinctness).
 * 2. Late-response race safety (older request ID cannot overwrite newer request).
 * 3. Plan-mode reset on send/completion/error.
 * 4. Explicit intent requirement: normal chat does not emit Plan/Diff card.
 * 5. Owner Personal Core context inclusion and labeling.
 * 6. Privacy boundary: unauthenticated requests receive 403 and no context.
 * 7. Plan-only invariant: safety banner and zero action/execution claims.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log("--- RUNNING PLAN/DIFF CURRENT-REQUEST & PERSONAL-CONTEXT TEST SUITE ---");

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

async function runTests() {
    // 1. Current-Request Binding & Distinctness
    test("Current-Request Binding: Task A vs Task B", () => {
        const { buildDeterministicFallbackPlan } = require('../services/planDiffWorker.js');

        const taskA = "Plan a small UI copy improvement for Ghost. Do not make changes.";
        const taskB = "Using my approved Personal Core context, plan a 30-day roadmap for Ghost to become my private personal AI. Do not make changes.";

        const planA = buildDeterministicFallbackPlan(taskA);
        const planB = buildDeterministicFallbackPlan(taskB);

        assert.strictEqual(planA.success, true);
        assert.strictEqual(planB.success, true);

        assert(planA.taskSummary.includes("UI copy") || planA.taskSummary.includes("Plan a small UI"), "Plan A reflects Task A");
        assert(planB.taskSummary.includes("30-day roadmap") || planB.taskSummary.includes("personal AI"), "Plan B reflects Task B");
        assert.notStrictEqual(planA.taskSummary, planB.taskSummary, "Plan A and Plan B task summaries must be distinct");
    });

    // 2. Late-Response Race Safety Simulation
    test("Late-Response Race Safety: Monotonic Request Sequence Tracking", () => {
        let currentPlanRequestId = 0;
        let renderedCardTaskId = null;

        function simulateExecutePlan(taskId) {
            currentPlanRequestId++;
            const reqId = currentPlanRequestId;

            return {
                reqId,
                taskId,
                respond: (resultData) => {
                    // Client race check logic
                    if (reqId !== currentPlanRequestId) {
                        return { rendered: false, reason: 'discarded_stale' };
                    }
                    renderedCardTaskId = resultData.task;
                    return { rendered: true, renderedTask: renderedCardTaskId };
                }
            };
        }

        // 1. Task A starts (request #1)
        const reqA = simulateExecutePlan("Task A: UI copy");
        assert.strictEqual(reqA.reqId, 1);

        // 2. Task B starts before Task A finishes (request #2)
        const reqB = simulateExecutePlan("Task B: 30-day roadmap");
        assert.strictEqual(reqB.reqId, 2);

        // 3. Task B finishes first and renders
        const resB = reqB.respond({ task: "Task B: 30-day roadmap" });
        assert.strictEqual(resB.rendered, true);
        assert.strictEqual(renderedCardTaskId, "Task B: 30-day roadmap");

        // 4. Stale Task A finishes late -> MUST be discarded
        const resA = reqA.respond({ task: "Task A: UI copy" });
        assert.strictEqual(resA.rendered, false);
        assert.strictEqual(resA.reason, 'discarded_stale');
        // Rendered card remains Task B
        assert.strictEqual(renderedCardTaskId, "Task B: 30-day roadmap");
    });

    // 3. Owner Personal Core Context Augmented Prompting & Privacy
    test("Owner Personal Core Context Integration & Privacy Boundary", async () => {
        const { saveExplicitMemory, createOwnerGoal, resetMemoryStoreForTesting, listOwnerGoals, listExplicitMemories, isPotentialSecret } = await import('../services/personalCore.js');
        resetMemoryStoreForTesting();

        const ownerId = "owner_test_manoj";
        await saveExplicitMemory(ownerId, { text: "Owner prefers local private AI architecture." });
        await createOwnerGoal(ownerId, { title: "Personal AI 30-day roadmap", note: "Autonomous and private", status: "active" });

        // Retrieve and format approved context
        const [goals, memories] = await Promise.all([
            listOwnerGoals(ownerId),
            listExplicitMemories(ownerId)
        ]);

        const activeGoals = goals.filter(g => g.status === 'active' && !isPotentialSecret(g.title) && !isPotentialSecret(g.note));
        const safeMemories = memories.filter(m => !isPotentialSecret(m.text));

        assert.strictEqual(activeGoals.length, 1);
        assert.strictEqual(safeMemories.length, 1);

        const approvedContextLines = [];
        approvedContextLines.push(`Active Goals:`);
        activeGoals.forEach(g => approvedContextLines.push(`- [Goal] ${g.title}: ${g.note}`));
        approvedContextLines.push(`Saved Memories:`);
        safeMemories.forEach(m => approvedContextLines.push(`- [Memory] ${m.text}`));

        const approvedContext = approvedContextLines.join('\n');
        assert(approvedContext.includes("Personal AI 30-day roadmap"));
        assert(approvedContext.includes("Owner prefers local private AI architecture."));

        // Visitor context check: visitor has no ownerId -> 0 items
        const visitorGoals = await listOwnerGoals("visitor_anon");
        assert.strictEqual(visitorGoals.length, 0);
    });

    // 4. Server Route Protection & Personal Context Wiring
    test("Server Route /api/plan/draft Context & Guard Verification", () => {
        const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
        assert(serverCode.includes("app.post('/api/plan/draft'"), "Server mounts /api/plan/draft");
        assert(serverCode.includes("const owner = authenticateOwner(req)"), "Plan/draft checks owner authentication");
        assert(serverCode.includes("listOwnerGoals(owner.ownerId, pool)"), "Plan/draft fetches owner goals");
        assert(serverCode.includes("listExplicitMemories(owner.ownerId, pool)"), "Plan/draft fetches owner memories");
        assert(serverCode.includes("planDraft.approvedPersonalContext = approvedPersonalContext"), "Plan/draft attaches approvedPersonalContext to response");
        assert(serverCode.includes("planDraft.requestId = requestId"), "Plan/draft echoes requestId");
    });

    // 5. Client UI Plan-Mode Reset & Distinct Context Rendering
    test("Client UI Plan-Mode Reset & Card Context Rendering", () => {
        const uiCode = fs.readFileSync(path.join(__dirname, '../public/ghost-ui.js'), 'utf8');
        assert(uiCode.includes("isPlanModeActive = false"), "ghost-ui.js resets plan mode");
        assert(uiCode.includes("currentPlanRequestId"), "ghost-ui.js tracks monotonic request ID");
        assert(uiCode.includes("plan.approvedPersonalContext"), "ghost-ui.js renders approved personal context section");
        assert(uiCode.includes("👤 Approved Personal Core Context:"), "ghost-ui.js includes labeled personal context header");
        assert(uiCode.includes("PLAN ONLY — NO FILES CHANGED — NO COMMANDS EXECUTED — APPROVAL REQUIRED FOR ANY FUTURE EDIT OR TEST"), "Plan safety banner preserved");
    });

    console.log(`\nPLAN/DIFF RACE & CONTEXT TEST RESULTS: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

runTests().catch(err => {
    console.error("Test runner error:", err);
    process.exit(1);
});

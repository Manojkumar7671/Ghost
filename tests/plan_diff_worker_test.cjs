/**
 * tests/plan_diff_worker_test.cjs
 *
 * Hermes-Inspired Plan/Diff Worker V1 Test Suite
 * Validates plan-only contracts, zero-execution primitives, bounding,
 * deterministic fallback, and route security.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log("--- RUNNING PLAN/DIFF WORKER V1 BOUNDARY TEST SUITE ---");

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
    test("Zero Execution Primitives in Plan/Diff Worker", () => {
        const workerCode = fs.readFileSync(path.join(__dirname, '../services/planDiffWorker.js'), 'utf8');
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
            assert(!pattern.test(workerCode), `PlanDiffWorker must not contain forbidden primitive: ${pattern}`);
        }
    });

    // 2. Pure Module Import & Constants
    await asyncTest("Plan/Diff Worker Module Constants and Fallback Contract", async () => {
        const { SAFETY_NOTICE, DISCLAIMER, FIXED_STATUS, buildDeterministicFallbackPlan } = await import('../services/planDiffWorker.js');
        assert.strictEqual(FIXED_STATUS, "PLAN_ONLY", "Fixed status must be PLAN_ONLY");
        assert.strictEqual(SAFETY_NOTICE, "PLAN ONLY — NO FILES CHANGED — NO COMMANDS EXECUTED — APPROVAL REQUIRED FOR ANY FUTURE EDIT OR TEST");
        assert(DISCLAIMER.includes("Future edits and tests will require a separate, explicit owner approval workflow"));

        const fallback = buildDeterministicFallbackPlan("Add login button");
        assert.strictEqual(fallback.status, "PLAN_ONLY");
        assert.strictEqual(fallback.safetyNotice, SAFETY_NOTICE);
        assert.strictEqual(fallback.disclaimer, DISCLAIMER);
        assert(Array.isArray(fallback.planSteps) && fallback.planSteps.length > 0);
        assert(Array.isArray(fallback.assumptions) && fallback.assumptions.length > 0);
        assert(Array.isArray(fallback.risks) && fallback.risks.length > 0);
    });

    // 3. Input Validation
    await asyncTest("Input Validation and Bounding", async () => {
        const { generatePlanDraft } = await import('../services/planDiffWorker.js');
        const emptyResult = await generatePlanDraft("");
        assert.strictEqual(emptyResult.success, false);
        assert.strictEqual(emptyResult.status, "PLAN_ONLY");
        assert(emptyResult.error.includes("empty"));

        const nullResult = await generatePlanDraft(null);
        assert.strictEqual(nullResult.success, false);
        assert.strictEqual(nullResult.status, "PLAN_ONLY");
    });

    // 4. Server Route Authentication Gating
    test("Server Route /api/plan/draft Authorization and Fixed Status", () => {
        const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
        assert(serverCode.includes("app.post('/api/plan/draft'"), "Server mounts /api/plan/draft endpoint");
        assert(serverCode.includes("if (!checkIsAdmin(req))"), "Endpoint enforces checkIsAdmin authorization");
        assert(serverCode.includes("status: 'PLAN_ONLY'"), "Endpoint binds fixed PLAN_ONLY status");
    });

    // 5. UI Safe Text Rendering & Event Handling
    test("Client UI Plan/Diff Card Rendering and No-Action Notice", () => {
        const uiCode = fs.readFileSync(path.join(__dirname, '../public/ghost-ui.js'), 'utf8');
        assert(uiCode.includes("renderPlanDraftCard"), "UI defines renderPlanDraftCard");
        assert(uiCode.includes("PLAN ONLY — NO FILES CHANGED — NO COMMANDS EXECUTED — APPROVAL REQUIRED FOR ANY FUTURE EDIT OR TEST"), "UI includes mandatory safety notice banner");
        assert(uiCode.includes("Future edits and tests will require a separate, explicit owner approval workflow"), "UI includes disclaimer");
        assert(!uiCode.includes("applyPlanBtn") && !uiCode.includes("runPlanBtn"), "UI has zero Apply/Run action buttons");
    });

    // 6. Header Action Button & HTML Entry Point
    test("HTML Entry Point for Plan/Diff Action", () => {
        const htmlCode = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
        assert(htmlCode.includes('id="planDiffBtn"'), "index.html includes planDiffBtn action button");
    });

    console.log(`\nPLAN/DIFF WORKER SUITE RESULTS: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

runTests().catch(err => {
    console.error("Test runner error:", err);
    process.exit(1);
});

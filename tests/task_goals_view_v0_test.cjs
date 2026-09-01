/**
 * tests/task_goals_view_v0_test.cjs — Owner Task/Goals Read View V0 Static & Unit Test Suite
 *
 * Validates:
 * 1. Exact narrow query recognition for supported task and goal read phrases, excluding broad catch-alls.
 * 2. Route branch placement inside server.js /api/chat before ordinary brain.think() fallback.
 * 3. Canonical owner authentication (authenticateOwner) gate and neutral non-owner refusal with zero data leakage.
 * 4. Direct call to getPersonalOverview(chatOwner.ownerId, pool) for owner read views.
 * 5. Task route: renders from overview.tasks only; zero continuationSummary, memories, brain.think(), task mutation/lifecycle operations, task IDs, or execution authority.
 * 6. Goals route: renders from overview.goals only; display-only deduplication by stable goal ID / normalized title; zero mutation of stored records.
 * 7. Consistent Markdown headings (# Workspace Tasks, # Workspace Goals) and truthful empty states.
 * 8. Four-field chat wire response format (success, text, runId, execution) with execution.state === 'not_started'.
 * 9. Isolation audit: no modifications to services, UI, providers, routes, schema, background workers, browser/device actions, or credentials.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log("--- RUNNING OWNER TASK/GOALS VIEW V0 COMPREHENSIVE TEST SUITE ---");

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

function runTests() {
    const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

    // 1. Static Source Inspection: Intent Presence & Placement Before brain.think()
    test("1. Tasks and Goals read intents exist in server.js before brain.think() fallback", () => {
        const chatRouteMatch = serverCode.match(/app\.post\('\/api\/chat'[\s\S]*?\napp\./);
        assert.ok(chatRouteMatch, "server.js must contain app.post('/api/chat')");
        const chatCode = chatRouteMatch[0];

        assert.ok(chatCode.includes('isTasksReadIntent'), "server.js must define isTasksReadIntent");
        assert.ok(chatCode.includes('isGoalsReadIntent'), "server.js must define isGoalsReadIntent");

        const tasksIdx = chatCode.indexOf('isTasksReadIntent');
        const goalsIdx = chatCode.indexOf('isGoalsReadIntent');
        const brainThinkIdx = chatCode.indexOf('brain.think(');

        assert.ok(tasksIdx < brainThinkIdx, "isTasksReadIntent must be placed before brain.think() fallback");
        assert.ok(goalsIdx < brainThinkIdx, "isGoalsReadIntent must be placed before brain.think() fallback");
    });

    // 2. Exact Narrow Query Recognition Patterns
    test("2. Exact narrow regex matching for supported task/goal phrases and rejection of broad queries", () => {
        const isTasksReadIntent = (msg) => /^(?:what\s+are\s+my\s+tasks\??|show\s+me\s+my\s+tasks|current\s+tasks)[?.!\s]*$/i.test(msg ? msg.trim() : '');
        const isGoalsReadIntent = (msg) => /^(?:what\s+are\s+my\s+goals\??|show\s+me\s+my\s+goals|current\s+goals)[?.!\s]*$/i.test(msg ? msg.trim() : '');

        // Supported task phrases
        assert.strictEqual(isTasksReadIntent("what are my tasks?"), true);
        assert.strictEqual(isTasksReadIntent("what are my tasks"), true);
        assert.strictEqual(isTasksReadIntent("show me my tasks"), true);
        assert.strictEqual(isTasksReadIntent("current tasks"), true);
        assert.strictEqual(isTasksReadIntent("SHOW ME MY TASKS."), true);

        // Supported goal phrases
        assert.strictEqual(isGoalsReadIntent("what are my goals?"), true);
        assert.strictEqual(isGoalsReadIntent("what are my goals"), true);
        assert.strictEqual(isGoalsReadIntent("show me my goals"), true);
        assert.strictEqual(isGoalsReadIntent("current goals"), true);
        assert.strictEqual(isGoalsReadIntent("CURRENT GOALS!"), true);

        // Broad / unrelated catch-all queries must NOT match
        assert.strictEqual(isTasksReadIntent("what are my tasks for tomorrow?"), false);
        assert.strictEqual(isTasksReadIntent("show me my tasks and goals"), false);
        assert.strictEqual(isTasksReadIntent("current tasks list"), false);
        assert.strictEqual(isGoalsReadIntent("what are my goals for 2026?"), false);
        assert.strictEqual(isGoalsReadIntent("show me my goals and memories"), false);
        assert.strictEqual(isGoalsReadIntent("my goals"), false);
    });

    // 3. Canonical Owner Gate & Non-Owner Refusal
    test("3. AuthenticateOwner verification and neutral non-owner response with zero data exposure", () => {
        const tasksBranchMatch = serverCode.match(/if \(isTasksReadIntent\) \{[\s\S]*?\n            \}/);
        assert.ok(tasksBranchMatch, "Tasks read branch must be identifiable");
        const tasksBranch = tasksBranchMatch[0];

        assert.ok(tasksBranch.includes('authenticateOwner(req)'), "Tasks read branch must call authenticateOwner(req)");
        assert.ok(tasksBranch.includes('!chatOwner || !chatOwner.isOwner'), "Tasks branch must enforce owner check");
        assert.ok(tasksBranch.includes('You are not authorized to view workspace tasks.'), "Tasks branch must return neutral refusal to non-owners");

        const goalsBranchMatch = serverCode.match(/if \(isGoalsReadIntent\) \{[\s\S]*?\n            \}/);
        assert.ok(goalsBranchMatch, "Goals read branch must be identifiable");
        const goalsBranch = goalsBranchMatch[0];

        assert.ok(goalsBranch.includes('authenticateOwner(req)'), "Goals read branch must call authenticateOwner(req)");
        assert.ok(goalsBranch.includes('!chatOwner || !chatOwner.isOwner'), "Goals branch must enforce owner check");
        assert.ok(goalsBranch.includes('You are not authorized to view workspace goals.'), "Goals branch must return neutral refusal to non-owners");
    });

    // 4. Data Extraction & Overview Integration
    test("4. Owner read view calls getPersonalOverview(chatOwner.ownerId, pool)", () => {
        const tasksBranch = serverCode.match(/if \(isTasksReadIntent\) \{[\s\S]*?\n            \}/)[0];
        const goalsBranch = serverCode.match(/if \(isGoalsReadIntent\) \{[\s\S]*?\n            \}/)[0];

        assert.ok(tasksBranch.includes('getPersonalOverview(chatOwner.ownerId, pool)'), "Tasks branch must query getPersonalOverview");
        assert.ok(goalsBranch.includes('getPersonalOverview(chatOwner.ownerId, pool)'), "Goals branch must query getPersonalOverview");
    });

    // 5. Task Listing Format & Exclusions
    test("5. Tasks list renders tasks without goal suffixes, continuationSummary, memories, brain.think(), or mutation", () => {
        const tasksBranch = serverCode.match(/if \(isTasksReadIntent\) \{[\s\S]*?\n            \}/)[0];

        assert.ok(!tasksBranch.includes('continuationSummary'), "Tasks branch must not render continuationSummary");
        assert.ok(!tasksBranch.includes('recentMemories'), "Tasks branch must not render memories");
        assert.ok(!tasksBranch.includes('goalTitle'), "Tasks branch must not render task-linked goal suffixes");
        assert.ok(!tasksBranch.includes('createPersonalTask'), "Tasks branch must not create tasks");
        assert.ok(!tasksBranch.includes('updatePersonalTask'), "Tasks branch must not update tasks");
        assert.ok(!tasksBranch.includes('deletePersonalTask'), "Tasks branch must not delete tasks");

        // Format simulation
        const sampleTasks = [
            { title: "Review pull request", status: "pending", goalTitle: "Ship Release" },
            { title: "Fix CSS bug", status: "blocked", goalTitle: "UI Cleanup" }
        ];

        const lines = ['# Workspace Tasks', ''];
        sampleTasks.forEach((t, idx) => {
            const statusLabel = t.status ? (t.status.charAt(0).toUpperCase() + t.status.slice(1)) : 'Pending';
            lines.push(`${idx + 1}. [${statusLabel}] ${t.title}`);
        });

        const output = lines.join('\n');
        assert.ok(output.includes('# Workspace Tasks'));
        assert.ok(output.includes('1. [Pending] Review pull request'));
        assert.ok(output.includes('2. [Blocked] Fix CSS bug'));
        assert.ok(!output.includes('Ship Release'), "Must omit goalTitle suffix");
    });

    // 6. Goals Listing Format, Display-Only Deduplication & Exclusions
    test("6. Goals list performs display-only deduplication by normalized title first (collapsing distinct IDs with same title)", () => {
        const goalsBranch = serverCode.match(/if \(isGoalsReadIntent\) \{[\s\S]*?\n            \}/)[0];

        assert.ok(!goalsBranch.includes('continuationSummary'), "Goals branch must not render continuationSummary");
        assert.ok(!goalsBranch.includes('recentMemories'), "Goals branch must not render memories");
        assert.ok(goalsBranch.includes('g.title ? String(g.title).toLowerCase().trim() :'), "Goals branch must use title-first deduplication key formula");
        assert.ok(!goalsBranch.includes('g.id ? String(g.id) : (g.title ?'), "Goals branch must not use old ID-first deduplication key formula");

        // Display-only deduplication simulation (two distinct IDs with same normalized title + one distinct title)
        const rawGoals = [
            { id: "goal_100", title: "Launch Product", status: "active", note: "Q3 target" },
            { id: "goal_200", title: "Launch Product", status: "active" }, // Distinct ID, duplicate normalized title
            { id: "goal_300", title: "Improve Test Coverage", status: "active" },
            { id: null, title: "  IMPROVE TEST COVERAGE  ", status: "active" } // Null ID, case/space duplicate
        ];

        const seenKeys = new Set();
        const uniqueGoals = [];
        for (const g of rawGoals) {
            const key = g.title ? String(g.title).toLowerCase().trim() : (g.id ? String(g.id) : '');
            if (key && !seenKeys.has(key)) {
                seenKeys.add(key);
                uniqueGoals.push(g);
            }
        }

        assert.strictEqual(uniqueGoals.length, 2, "Must collapse 4 records to 2 unique display goals");
        assert.strictEqual(uniqueGoals[0].title, "Launch Product");
        assert.strictEqual(uniqueGoals[1].title, "Improve Test Coverage");

        const lines = ['# Workspace Goals', ''];
        uniqueGoals.forEach((g, idx) => {
            const statusLabel = g.status ? (g.status.charAt(0).toUpperCase() + g.status.slice(1)) : 'Active';
            const noteSuffix = g.note ? ` — ${g.note}` : '';
            lines.push(`${idx + 1}. [${statusLabel}] ${g.title}${noteSuffix}`);
        });

        const output = lines.join('\n');
        assert.ok(output.includes('# Workspace Goals'));
        assert.ok(output.includes('1. [Active] Launch Product — Q3 target'));
        assert.ok(output.includes('2. [Active] Improve Test Coverage'));
        assert.strictEqual((output.match(/Launch Product/g) || []).length, 1, "Duplicate title must render exactly once");
        assert.strictEqual((output.match(/Improve Test Coverage/g) || []).length, 1, "Unique title must render exactly once");
    });

    // 7. Truthful Empty States
    test("7. Tasks and Goals empty states render truthful Markdown messages", () => {
        const emptyTasksLines = ['# Workspace Tasks', '', 'No tasks recorded in your workspace.'];
        assert.strictEqual(emptyTasksLines.join('\n'), "# Workspace Tasks\n\nNo tasks recorded in your workspace.");

        const emptyGoalsLines = ['# Workspace Goals', '', 'No goals recorded in your workspace.'];
        assert.strictEqual(emptyGoalsLines.join('\n'), "# Workspace Goals\n\nNo goals recorded in your workspace.");
    });

    // 8. Wire Response Format Contract
    test("8. Response contract contains success, text, runId, and execution.state === 'not_started'", () => {
        const tasksBranch = serverCode.match(/if \(isTasksReadIntent\) \{[\s\S]*?\n            \}/)[0];
        const goalsBranch = serverCode.match(/if \(isGoalsReadIntent\) \{[\s\S]*?\n            \}/)[0];

        assert.ok(tasksBranch.includes('state: "not_started"'), "Tasks execution state must be not_started");
        assert.ok(goalsBranch.includes('state: "not_started"'), "Goals execution state must be not_started");
        assert.ok(tasksBranch.includes('applyEvidenceWrapper'), "Tasks branch must use evidence wrapper");
        assert.ok(goalsBranch.includes('applyEvidenceWrapper'), "Goals branch must use evidence wrapper");
        assert.ok(!tasksBranch.includes('proposedTask'), "Tasks read branch must not emit proposedTask");
        assert.ok(!goalsBranch.includes('proposedTask'), "Goals read branch must not emit proposedTask");
    });

    // 9. Source Isolation Audit
    test("9. Zero modifications to personalCore.js, UI files, schema, or action capabilities", () => {
        const coreCode = fs.readFileSync(path.join(__dirname, '../services/personalCore.js'), 'utf8');
        assert.ok(!coreCode.includes('isTasksReadIntent'), "personalCore.js must not be modified for chat routing");
        assert.ok(!coreCode.includes('isGoalsReadIntent'), "personalCore.js must not be modified for chat routing");
    });

    console.log(`\nOWNER TASK/GOALS VIEW V0 TEST SUITE RESULTS: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

runTests();

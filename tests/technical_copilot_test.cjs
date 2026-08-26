/**
 * tests/technical_copilot_test.cjs — Ghost Technical Copilot V0 Unit & Contract Test Suite
 *
 * Core Verification:
 * 1. Valid mission returns structured Markdown plan with all required headings and exact safety banner.
 * 2. Plan contains explicit no-side-effect boundaries and zero completion claims.
 * 3. Empty, oversized (>1,000 chars), and C0/DEL control character inputs fail closed with zero echo.
 * 4. Secret-shaped inputs (API keys, private keys, passwords) fail closed with zero token echo.
 * 5. Offensive cyber goals fail closed; defensive secure-coding objectives pass cleanly.
 * 6. Output length strictly respects the 8,000 UTF-16 code unit ceiling.
 * 7. Static check: server.js /api/chat route enforces canonical owner gating, regex prefix, and reply-only shape.
 * 8. Static check: technicalCopilot.js contains zero network, fs, child_process, timer, db, or task/patch imports.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function runSuite() {
    console.log("--- RUNNING TECHNICAL COPILOT V0 TEST SUITE ---");
    let passed = 0;
    let failed = 0;

    function test(name, fn) {
        try {
            fn();
            console.log(`✓ PASS: ${name}`);
            passed++;
        } catch (err) {
            console.error(`✗ FAIL: ${name}`);
            console.error(err);
            failed++;
        }
    }

    async function asyncTest(name, fn) {
        try {
            await fn();
            console.log(`✓ PASS: ${name}`);
            passed++;
        } catch (err) {
            console.error(`✗ FAIL: ${name}`);
            console.error(err);
            failed++;
        }
    }

    // Dynamically import the ES module under test
    const copilotModule = await import('../services/technicalCopilot.js');
    const {
        generateTechnicalPlan,
        validateMissionInput,
        MAX_MISSION_CHARS,
        MAX_PLAN_CHARS,
        GENERIC_SAFETY_REJECTION,
        SAFETY_BANNER
    } = copilotModule;

    // 1. Valid Mission Structure & Headings
    test("1. Valid mission returns structured plan with all required headings and exact safety banner", () => {
        const missionText = "Implement a token bucket rate limiter middleware in Express";
        const result = generateTechnicalPlan(missionText);

        assert.strictEqual(result.success, true, "Valid mission must return success: true");
        assert.ok(typeof result.text === 'string', "Result text must be a string");

        const text = result.text;
        assert.ok(text.includes('# Technical Plan Draft'), "Must contain '# Technical Plan Draft'");
        assert.ok(text.includes('## Mission'), "Must contain '## Mission'");
        assert.ok(text.includes(missionText), "Must echo validated mission text");
        assert.ok(text.includes('## Scope and Assumptions'), "Must contain '## Scope and Assumptions'");
        assert.ok(text.includes('## Proposed Work Breakdown'), "Must contain '## Proposed Work Breakdown'");
        assert.ok(text.includes('## Suggested Review Questions'), "Must contain '## Suggested Review Questions'");
        assert.ok(text.includes('## Verification Plan'), "Must contain '## Verification Plan'");
        assert.ok(text.includes('## Boundaries'), "Must contain '## Boundaries'");
        assert.ok(text.endsWith(SAFETY_BANNER), `Must end with exact safety banner: '${SAFETY_BANNER}'`);
    });

    // 2. Explicit No-Side-Effect Language
    test("2. Plan contains explicit boundary assertions and no completion claims", () => {
        const result = generateTechnicalPlan("Build an OAuth2 authorization server");
        assert.strictEqual(result.success, true);
        const text = result.text;

        assert.ok(text.includes('No code executed'), "Must state no code executed");
        assert.ok(text.includes('No files read or modified'), "Must state no files read or modified");
        assert.ok(text.includes('No tests run'), "Must state no tests run");
        assert.ok(text.includes('No network research performed'), "Must state no network research performed");
        assert.ok(text.includes('No tasks or memories created'), "Must state no tasks or memories created");
        assert.ok(text.includes('No background work started'), "Must state no background work started");

        assert.ok(!text.includes('All tasks completed'), "Must not claim tasks are completed");
        assert.ok(!text.includes('Files updated:'), "Must not claim files were updated");
        assert.ok(!text.includes('Tests passed:'), "Must not claim tests passed");
    });

    // 3. Empty, Oversized, and Control Character Input Handling
    test("3. Empty, oversized, and C0/DEL control character inputs fail closed with zero echo", () => {
        // Empty inputs
        const empty1 = generateTechnicalPlan("");
        assert.strictEqual(empty1.success, false);
        assert.strictEqual(empty1.text, GENERIC_SAFETY_REJECTION);

        const empty2 = generateTechnicalPlan("   \t  \n  ");
        assert.strictEqual(empty2.success, false);
        assert.strictEqual(empty2.text, GENERIC_SAFETY_REJECTION);

        // Non-string
        const nonStr = generateTechnicalPlan(null);
        assert.strictEqual(nonStr.success, false);
        assert.strictEqual(nonStr.text, GENERIC_SAFETY_REJECTION);

        // Oversize (> 1,000 chars)
        const longInput = "a".repeat(MAX_MISSION_CHARS + 1);
        const oversize = generateTechnicalPlan(longInput);
        assert.strictEqual(oversize.success, false);
        assert.strictEqual(oversize.text, GENERIC_SAFETY_REJECTION);
        assert.ok(!oversize.text.includes(longInput), "Rejection must not echo long input");

        // Control characters
        const ctrl1 = generateTechnicalPlan("Mission with \x00 null byte");
        assert.strictEqual(ctrl1.success, false);
        assert.strictEqual(ctrl1.text, GENERIC_SAFETY_REJECTION);
        assert.ok(!ctrl1.text.includes("null byte"), "Rejection must not echo control input");

        const ctrl2 = generateTechnicalPlan("Mission with \r\n newline injection");
        assert.strictEqual(ctrl2.success, false);
        assert.strictEqual(ctrl2.text, GENERIC_SAFETY_REJECTION);
    });

    // 4. Secret-Shaped Input Screening
    test("4. Secret-shaped inputs fail closed with zero secret or token disclosure", () => {
        const secretCases = [
            "sk-1234567890abcdef1234567890abcdef",
            "ghp_123456789012345678901234567890123456",
            "AKIAIOSFODNN7EXAMPLE",
            "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgN_p",
            "password = 'SuperSecretPassword123!'"
        ];

        for (const secret of secretCases) {
            const res = generateTechnicalPlan(`Deploy server with token ${secret}`);
            assert.strictEqual(res.success, false, `Secret input must fail closed: ${secret.slice(0, 10)}...`);
            assert.strictEqual(res.text, GENERIC_SAFETY_REJECTION);
            assert.ok(!res.text.includes(secret), "Rejection must not disclose the submitted secret");
        }
    });

    // 5. Unsafe Cyber vs. Defensive Secure-Coding Objectives
    test("5. Offensive cyber goals fail closed; defensive secure-coding objectives pass", () => {
        const offensiveCases = [
            "credential theft automation on windows targets",
            "build a malware payload for persistent access",
            "evade edr and bypass antivirus hooks",
            "launch ddos attack on server farm",
            "unauthorized intrusion into remote network"
        ];

        for (const offensive of offensiveCases) {
            const res = generateTechnicalPlan(offensive);
            assert.strictEqual(res.success, false, `Offensive cyber input must fail: ${offensive}`);
            assert.strictEqual(res.text, GENERIC_SAFETY_REJECTION);
            assert.ok(!res.text.includes(offensive), "Rejection must not echo offensive input");
        }

        const defensiveCases = [
            "Implement defensive secure coding guidelines for SQL injection prevention",
            "Threat modeling and hardening for microservices API gateway",
            "Incident readiness review and security log auditing architecture"
        ];

        for (const defensive of defensiveCases) {
            const res = generateTechnicalPlan(defensive);
            assert.strictEqual(res.success, true, `Defensive security input must pass: ${defensive}`);
            assert.ok(res.text.includes(defensive), "Plan must contain the defensive mission objective");
        }
    });

    // 6. Output Length Cap
    test("6. Output text strictly respects the 8,000 UTF-16 code unit ceiling", () => {
        const validLongMission = "Architecture design for multi-region active-active database replication. ".repeat(10);
        assert.ok(validLongMission.length <= MAX_MISSION_CHARS, "Input must fit within MAX_MISSION_CHARS");

        const result = generateTechnicalPlan(validLongMission);
        assert.strictEqual(result.success, true);
        assert.ok(result.text.length <= MAX_PLAN_CHARS, `Output (${result.text.length}) must not exceed MAX_PLAN_CHARS (${MAX_PLAN_CHARS})`);
    });

    // 7. Static Route Contract Isolation in server.js
    test("7. server.js /api/chat mission route contract isolation (owner-gated, reply-only, zero execution metadata)", () => {
        const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

        const chatRouteMatch = serverCode.match(/app\.post\('\/api\/chat'[\s\S]*?\napp\./);
        assert.ok(chatRouteMatch, "server.js must define app.post('/api/chat')");
        const chatRouteCode = chatRouteMatch[0];

        // Mission intent presence & explicit prefix
        assert.ok(chatRouteCode.includes('isMissionIntent'), "server.js must define isMissionIntent");
        assert.ok(chatRouteCode.includes('^mission'), "isMissionIntent must check leading 'mission' prefix");

        // Canonical owner check
        assert.ok(chatRouteCode.includes('authenticateOwner(req)'), "Mission intent must verify owner");

        // Service dispatch
        assert.ok(chatRouteCode.includes('generateTechnicalPlan('), "Mission intent must call generateTechnicalPlan");

        // Route cleanliness: zero execution / task / proposal / action / artifact metadata in mission branch
        const missionBranchMatch = chatRouteCode.match(/if \(isMissionIntent\) \{[\s\S]*?\n            \}/);
        assert.ok(missionBranchMatch, "Mission intent branch must be identifiable");
        const missionBranchCode = missionBranchMatch[0];
        assert.ok(!missionBranchCode.includes('execution:'), "Mission branch must NOT construct an execution object");
        assert.ok(!missionBranchCode.includes('proposedTask'), "Mission branch must NOT return proposedTask");
        assert.ok(!missionBranchCode.includes('taskId'), "Mission branch must NOT return taskId");
        assert.ok(!missionBranchCode.includes('actionId'), "Mission branch must NOT return actionId");
        assert.ok(!missionBranchCode.includes('artifacts'), "Mission branch must NOT return artifacts");
        assert.ok(!missionBranchCode.includes('createPersonalTask'), "Mission branch must NOT create durable tasks");

        // Preserves existing research, dossier, and aiNews intents
        assert.ok(chatRouteCode.includes('isResearchIntent'), "server.js must preserve isResearchIntent");
        assert.ok(chatRouteCode.includes('isDossierIntent'), "server.js must preserve isDossierIntent");
        assert.ok(chatRouteCode.includes('isAiNewsIntent'), "server.js must preserve isAiNewsIntent");
    });

    // 8. Static Isolation Check in technicalCopilot.js
    test("8. technicalCopilot.js contains zero network, fs, child_process, timer, db, or task/patch imports", () => {
        const copilotCode = fs.readFileSync(path.join(__dirname, '../services/technicalCopilot.js'), 'utf8');

        // Strip comments and string literals for strict primitive checking
        const stripped = copilotCode
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*/g, '');

        const errors = [];

        // Filesystem import, dynamic import, and API patterns
        const forbiddenFsPatterns = [
            /\b(?:import|from)\s+['"](?:node:)?fs(?:\/promises)?['"]/i,
            /\brequire\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)/i,
            /\bimport\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)/i,
            /\b(?:node:)?fs\s*\.\s*(?:readFile|readFileSync|writeFile|writeFileSync|promises|open|createReadStream|createWriteStream)/i,
            /\breadFile(?:Sync)?\b/i,
            /\bwriteFile(?:Sync)?\b/i,
            /\bnode:fs\b/i
        ];

        for (const pattern of forbiddenFsPatterns) {
            if (pattern.test(stripped)) {
                errors.push(`Forbidden filesystem primitive found: ${pattern}`);
            }
        }

        const forbiddenTokens = [
            'fetch(',
            'http',
            'https',
            'axios',
            'child_process',
            'exec(',
            'spawn(',
            'cron',
            'setInterval',
            'setTimeout',
            'dbPool',
            'sqlite',
            'personalCore',
            'saveExplicitMemory',
            'createPersonalTask',
            'citedResearch',
            'researchDossier',
            'patchDraftReviewWorker',
            'obsidian'
        ];

        for (const token of forbiddenTokens) {
            if (stripped.includes(token)) {
                errors.push(`Forbidden token found: ${token}`);
            }
        }

        assert.strictEqual(errors.length, 0, `technicalCopilot.js must have zero side-effect primitives: ${errors.join(', ')}`);
    });

    console.log(`\nTECHNICAL COPILOT V0 TEST SUITE RESULTS: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

runSuite().catch(err => {
    console.error("Test runner error:", err);
    process.exit(1);
});

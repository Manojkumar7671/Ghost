/**
 * tests/plain_language_intent_test.cjs — Focused Unit, Integration Contract & Static Isolation Suite
 *
 * Covers:
 * 1. Recognized news phrases extract topic and select 'research'.
 * 2. Recognized scholarly/paper/deep-research phrases extract topic and select 'dossier'.
 * 3. Recognized planning phrases extract objective and select 'mission'.
 * 4. Category-without-topic/objective returns bounded deterministic clarification.
 * 5. General talk, website/media actions, code-write requests, secret-like input, controls, harmful cyber, scraping are not routed (null).
 * 6. Repeated identical input yields deterministic identical classification.
 * 7. Bounded input / topic / objective behavior.
 * 8. Static isolation check in plainLanguageRouter.js (zero network, fs, LLM, child_process, timer, db, or task/patch imports).
 * 9. server.js route contract verification (owner gating, prefix precedence, reply-only response, zero extra authority).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function runSuite() {
    console.log("--- RUNNING PLAIN-LANGUAGE INTENT V0 TEST SUITE ---");

    const routerModule = await import('../services/plainLanguageRouter.js');
    const {
        classifyPlainLanguageIntent,
        MAX_INPUT_CHARS,
        MAX_TOPIC_CHARS
    } = routerModule;

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

    // 1. News intent recognition and parameter extraction
    test("1. Natural news phrases extract clean topic and select 'research'", () => {
        const cases = [
            { input: "What is the latest AI news?", expectedTopic: "AI" },
            { input: "Show me the latest quantum computing news.", expectedTopic: "quantum computing" },
            { input: "Find current news about cybersecurity", expectedTopic: "cybersecurity" },
            { input: "Find news about renewable energy", expectedTopic: "renewable energy" },
            { input: "Latest news on space exploration", expectedTopic: "space exploration" },
            { input: "What's the latest fusion energy news?", expectedTopic: "fusion energy" }
        ];

        for (const c of cases) {
            const result = classifyPlainLanguageIntent(c.input);
            assert.ok(result, `Should classify: ${c.input}`);
            assert.strictEqual(result.type, 'route');
            assert.strictEqual(result.route, 'research');
            assert.strictEqual(result.topic, c.expectedTopic);
        }
    });

    // 2. Scholarly / deep research recognition and parameter extraction
    test("2. Natural scholarly/paper/deep-research phrases extract clean topic and select 'dossier'", () => {
        const cases = [
            { input: "Give me scholarly sources on quantum physics.", expectedTopic: "quantum physics" },
            { input: "Find scholarly sources on general relativity", expectedTopic: "general relativity" },
            { input: "Find papers on CRISPR cas9", expectedTopic: "CRISPR cas9" },
            { input: "Do a deep research on graph neural networks", expectedTopic: "graph neural networks" },
            { input: "Search academic papers on dark matter", expectedTopic: "dark matter" },
            { input: "Give me academic papers on mRNA vaccines", expectedTopic: "mRNA vaccines" }
        ];

        for (const c of cases) {
            const result = classifyPlainLanguageIntent(c.input);
            assert.ok(result, `Should classify: ${c.input}`);
            assert.strictEqual(result.type, 'route');
            assert.strictEqual(result.route, 'dossier');
            assert.strictEqual(result.topic, c.expectedTopic);
        }
    });

    // 3. Technical planning recognition and parameter extraction
    test("3. Natural planning phrases extract clean objective and select 'mission'", () => {
        const cases = [
            { input: "Plan a login page improvement.", expectedObjective: "a login page improvement" },
            { input: "Create an implementation plan for WebSocket chat server", expectedObjective: "WebSocket chat server" },
            { input: "Make a technical plan for OAuth2 migration", expectedObjective: "OAuth2 migration" },
            { input: "Draft an implementation plan for distributed caching", expectedObjective: "distributed caching" },
            { input: "Plan a technical approach for database indexing", expectedObjective: "database indexing" }
        ];

        for (const c of cases) {
            const result = classifyPlainLanguageIntent(c.input);
            assert.ok(result, `Should classify: ${c.input}`);
            assert.strictEqual(result.type, 'route');
            assert.strictEqual(result.route, 'mission');
            assert.strictEqual(result.objective, c.expectedObjective);
        }
    });

    // 4. Category-without-topic returns deterministic clarification
    test("4. Missing topic/objective returns single bounded clarification", () => {
        const newsClarification = classifyPlainLanguageIntent("What is the latest news?");
        assert.ok(newsClarification);
        assert.strictEqual(newsClarification.type, 'clarification');
        assert.strictEqual(newsClarification.route, 'research');
        assert.strictEqual(newsClarification.text, "What topic do you want current news about?");

        const dossierClarification = classifyPlainLanguageIntent("Give me scholarly sources");
        assert.ok(dossierClarification);
        assert.strictEqual(dossierClarification.type, 'clarification');
        assert.strictEqual(dossierClarification.route, 'dossier');
        assert.strictEqual(dossierClarification.text, "What topic should I make a bounded scholarly-source overview for?");

        const planClarification = classifyPlainLanguageIntent("Plan");
        assert.ok(planClarification);
        assert.strictEqual(planClarification.type, 'clarification');
        assert.strictEqual(planClarification.route, 'mission');
        assert.strictEqual(planClarification.text, "What would you like me to plan?");
    });

    // 5. Deliberately untriggered / non-routed categories
    test("5. General talk, browser/media actions, code requests, secrets, controls, and cyber goals return null", () => {
        const unrouted = [
            "Tell me about the war in ancient Rome",
            "Help me with React hooks",
            "What is the capital of France?",
            "Open YouTube and play a song",
            "Open Safari and go to google.com",
            "Browse to example.com",
            "Write a Python function to sort a list",
            "Build a fullstack web app in Go",
            "Remember that I like dark mode",
            "Save this task: fix the auth bug",
            "Here is my API key: gsk_1234567890abcdef123456",
            "Generate a malware payload builder",
            "credential theft scripts",
            "hello\x00world",
            "   ",
            ""
        ];

        for (const input of unrouted) {
            const result = classifyPlainLanguageIntent(input);
            assert.strictEqual(result, null, `Should return null for: "${input}"`);
        }
    });

    // 6. Determinism: identical input yields identical output
    test("6. Repeated identical inputs yield identical deterministic classifications", () => {
        const inputs = [
            "What is the latest AI news?",
            "Give me scholarly sources on quantum physics.",
            "Plan a frontend redesign",
            "Tell me about quantum physics",
            "Open YouTube"
        ];

        for (const input of inputs) {
            const first = classifyPlainLanguageIntent(input);
            const second = classifyPlainLanguageIntent(input);
            assert.deepStrictEqual(first, second, `Deterministic match failed for: ${input}`);
        }
    });

    // 7. Bounded parameter behavior and length caps
    test("7. Input and parameter boundaries are strictly enforced", () => {
        assert.strictEqual(typeof MAX_INPUT_CHARS, 'number');
        assert.strictEqual(typeof MAX_TOPIC_CHARS, 'number');

        // Oversized input returns null
        const oversized = "Plan " + "a".repeat(MAX_INPUT_CHARS + 10);
        assert.strictEqual(classifyPlainLanguageIntent(oversized), null);

        // Topic length cap
        const longTopic = "What is the latest " + "x".repeat(300) + " news?";
        const result = classifyPlainLanguageIntent(longTopic);
        assert.ok(result);
        assert.ok(result.topic.length <= MAX_TOPIC_CHARS);
    });

    // 8. Static Isolation Check in plainLanguageRouter.js
    test("8. plainLanguageRouter.js contains zero network, fs, LLM, child_process, timer, db, or task/patch imports", () => {
        const routerCode = fs.readFileSync(path.join(__dirname, '../services/plainLanguageRouter.js'), 'utf8');

        // Strip comments for strict primitive checking
        const stripped = routerCode
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
            'technicalCopilot',
            'patchDraftReviewWorker',
            'obsidian',
            'GoogleGenerativeAI',
            'Groq',
            'OpenAI',
            'Anthropic'
        ];

        for (const token of forbiddenTokens) {
            if (stripped.includes(token)) {
                errors.push(`Forbidden token found: ${token}`);
            }
        }

        assert.strictEqual(errors.length, 0, `plainLanguageRouter.js must have zero side-effect primitives: ${errors.join(', ')}`);
    });

    // 9. server.js Route Integration Contract
    test("9. server.js /api/chat integrates plainLanguageRouter with owner gating, prefix precedence, and reply-only responses", () => {
        const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

        // 1. Static ESM import
        assert.ok(serverCode.includes("classifyPlainLanguageIntent") && serverCode.includes("./services/plainLanguageRouter.js"),
                  "server.js must statically import classifyPlainLanguageIntent from ./services/plainLanguageRouter.js");

        // 2. Chat route definition
        const chatRoutePos = serverCode.indexOf("app.post('/api/chat'");
        assert.ok(chatRoutePos !== -1, "server.js must define app.post('/api/chat')");

        // 3. Local OS/media refusal path
        const isLocalPos = serverCode.indexOf('isLocalRequest', chatRoutePos);
        assert.ok(isLocalPos !== -1, "server.js /api/chat must contain isLocalRequest local app/media refusal");

        // 4. Explicit prefix intent matchers
        const isResearchPos = serverCode.indexOf('isResearchIntent', chatRoutePos);
        assert.ok(isResearchPos !== -1, "server.js /api/chat must contain isResearchIntent");

        const isDossierPos = serverCode.indexOf('isDossierIntent', chatRoutePos);
        assert.ok(isDossierPos !== -1, "server.js /api/chat must contain isDossierIntent");

        const isMissionPos = serverCode.indexOf('isMissionIntent', chatRoutePos);
        assert.ok(isMissionPos !== -1, "server.js /api/chat must contain isMissionIntent");

        // 5. Plain-language dispatch
        const plainIntentPos = serverCode.indexOf('classifyPlainLanguageIntent', chatRoutePos);
        assert.ok(plainIntentPos !== -1, "server.js /api/chat must invoke classifyPlainLanguageIntent");

        // 6. Precedence ordering verification across full source
        assert.ok(chatRoutePos < isLocalPos, "Chat route must start before isLocalRequest");
        assert.ok(isLocalPos < isResearchPos, "Local/media request refusal must precede research prefix");
        assert.ok(isResearchPos < isDossierPos, "Research prefix must precede dossier prefix");
        assert.ok(isDossierPos < isMissionPos, "Dossier prefix must precede mission prefix");
        assert.ok(isMissionPos < plainIntentPos, "Explicit prefix intents must precede plain-language router dispatch");

        // 7. Owner-gating verification in dispatch block
        const plainDispatchBlock = serverCode.slice(plainIntentPos - 200, plainIntentPos + 1600);
        assert.ok(plainDispatchBlock.includes('authenticateOwner(req)'), "Plain-language dispatch must be owner-gated");
        assert.ok(plainDispatchBlock.includes('plainLanguageOwner.isOwner'), "Plain-language dispatch must check isOwner");

        // 8. Reply-only contract (zero new execution metadata or taskId authority)
        assert.ok(plainDispatchBlock.includes('res.json({'), "Plain-language dispatch must return res.json");
        assert.ok(!plainDispatchBlock.includes('taskId'), "Plain-language dispatch must NOT return taskId");
        assert.ok(!plainDispatchBlock.includes('artifacts'), "Plain-language dispatch must NOT return artifacts");
        assert.ok(!plainDispatchBlock.includes('actionId'), "Plain-language dispatch must NOT return actionId");
    });

    console.log(`\nPLAIN-LANGUAGE INTENT V0 TEST SUITE RESULTS: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

runSuite().catch(err => {
    console.error("Test runner failed:", err);
    process.exitCode = 1;
});

/**
 * tests/ordinary_chat_factual_humility_test.cjs — Static Regression Test for Ordinary Chat Factual Humility
 *
 * Invariants & Contract:
 * - Pure static source test: Reads only src/brain.js via repository-relative path.
 * - Zero model execution, zero network requests, zero subprocess execution.
 * - Verifies fast-path systemPrompt contains factual humility, non-anthropomorphism,
 *   research distinction, and calm uncertainty language directives.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runSuite() {
    console.log("--- RUNNING ORDINARY CHAT FACTUAL HUMILITY STATIC TEST SUITE ---");

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

    const brainPath = path.join(__dirname, '../src/brain.js');
    assert.ok(fs.existsSync(brainPath), `src/brain.js must exist at ${brainPath}`);
    const brainSource = fs.readFileSync(brainPath, 'utf8');

    // 1. Fast Path systemPrompt presence
    test("1. Ordinary-chat Fast Path systemPrompt is present in src/brain.js", () => {
        assert.ok(brainSource.includes("let systemPrompt = `You are Ghost"), "src/brain.js must contain fast-path systemPrompt");
        assert.ok(brainSource.includes("Factual Humility & Boundaries:"), "systemPrompt must have Factual Humility header");
    });

    // 2. Factual humility assertion
    test("2. System prompt requires factual humility (no unverified claims as fact)", () => {
        const hasFactualHumility = /Do not present uncertain, disputed, speculative, or unverified claims as established fact/i.test(brainSource);
        assert.ok(hasFactualHumility, "systemPrompt must explicitly forbid presenting uncertain/speculative claims as established fact");
    });

    // 3. AI non-anthropomorphism assertion
    test("3. System prompt forbids claims of self-awareness, consciousness, or independent agency", () => {
        const hasNonAnthropomorphism = /Do not state or imply that AI systems are self-aware, conscious, independently motivated, or possess human-like agency as fact/i.test(brainSource);
        assert.ok(hasNonAnthropomorphism, "systemPrompt must forbid claiming AI self-awareness, consciousness, or independent motivation as fact");
    });

    // 4. Research distinction assertion
    test("4. System prompt distinguishes conversational explanation from verified/cited research", () => {
        const hasResearchDistinction = /Clearly distinguish ordinary conversational explanations from verified or cited research/i.test(brainSource);
        assert.ok(hasResearchDistinction, "systemPrompt must require distinguishing conversational explanation from verified research");

        const hasBoundedSuggestions = /suggest.*the existing bounded current-news.*or scholarly-dossier.*without automatically invoking/i.test(brainSource);
        assert.ok(hasBoundedSuggestions, "systemPrompt must suggest bounded research/dossier capabilities without auto-invoking them");
    });

    // 5. Calm uncertainty language assertion
    test("5. System prompt requires calm uncertainty language rather than fabricated certainty", () => {
        const hasUncertaintyLanguage = /use concise uncertainty language rather than fabricating certainty/i.test(brainSource);
        assert.ok(hasUncertaintyLanguage, "systemPrompt must instruct model to use concise uncertainty language when knowledge is uncertain");
    });

    // 6. Preserved code-as-text boundary
    test("6. System prompt preserves code-as-text safety instruction", () => {
        const hasCodeSafety = /markdown text code blocks without claiming it was saved, executed, or tested in this chat/i.test(brainSource);
        assert.ok(hasCodeSafety, "systemPrompt must retain code-as-text safety instruction");
    });

    // 7. Test harness self-isolation verification
    test("7. Static test harness performs zero network, LLM invocation, or process actions", () => {
        const testSelfSource = fs.readFileSync(__filename, 'utf8');

        // Verify that require() only imports allowed standard built-in modules
        const requireMatches = [...testSelfSource.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
        const allowedRequires = ['assert', 'fs', 'path'];
        for (const req of requireMatches) {
            assert.ok(allowedRequires.includes(req), `Test harness must only require allowed built-in modules, found: ${req}`);
        }

        // Strip comments and string literals to check actual executable call patterns
        const strippedExecutableCode = testSelfSource
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*/g, '')
            .replace(/'(?:[^'\\]|\\.)*'/g, "''")
            .replace(/"(?:[^"\\]|\\.)*"/g, '""')
            .replace(/`(?:\\[\s\S]|[^\\`])*`/g, '``');

        // Disallow forbidden executable invocations in the stripped code
        const forbiddenInvocations = [
            /\bfetch\s*\(/i,
            /\b(?:http|https)\s*\.\s*(?:get|request)\b/i,
            /\b(?:exec|execSync|spawn|spawnSync|fork)\s*\(/i,
            /\b(?:chat|callLLM)\s*\(/i,
            /\bprocess\s*\.\s*env\b/i
        ];

        for (const pattern of forbiddenInvocations) {
            assert.ok(!pattern.test(strippedExecutableCode), `Test file must not contain executable invocation: ${pattern}`);
        }
    });

    console.log(`\nORDINARY CHAT FACTUAL HUMILITY TEST RESULTS: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

runSuite();

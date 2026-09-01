/**
 * tests/session_context_v0_test.cjs — Session Context V0 Static & Unit Test Suite
 *
 * Validates:
 * 1. Process-memory Map history storage in src/tools/memory.js with zero disk persistence primitives in chat history paths.
 * 2. Per-owner isolation, 10,000-character content truncation, 12-turn retained cap, and 6-turn default retrieval limit.
 * 3. Clear-one-owner-only in-memory session reset and restart-loss-by-construction via process-memory Map architecture.
 * 4. Legacy file isolation: chat_history_*.json files are neither read, written, deleted, nor enumerated.
 * 5. Extraction of actual isClearContextIntent regex from server.js and pattern matching against accepted/rejected phrases.
 * 6. Bounded section 2.11 clear branch extraction from server.js before section 3, verifying non-owner and owner paths,
 *    canonical clearHistory(chatOwner.ownerId) call, in-memory clear wording, explicit non-mutation statement, and four-field not_started wire contract.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { pathToFileURL } = require('url');

console.log("--- RUNNING SESSION CONTEXT V0 COMPREHENSIVE TEST SUITE ---");

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
    const memoryModuleUrl = pathToFileURL(path.join(__dirname, '../src/tools/memory.js')).href;
    const memory = await import(memoryModuleUrl);

    // 1. Static Source Inspection: Zero Chat-History Disk Primitives in src/tools/memory.js
    test("1. src/tools/memory.js contains zero chat-history file read/write/delete/enumeration primitives", () => {
        const memoryCode = fs.readFileSync(path.join(__dirname, '../src/tools/memory.js'), 'utf8');

        // Extract chat history functions
        const historyFunctionsMatch = memoryCode.match(/(?:const sessionHistories|function loadHistory)[\s\S]*?(?=function loadMemory)/);
        assert.ok(historyFunctionsMatch, "src/tools/memory.js must contain chat history functions");
        const historyCode = historyFunctionsMatch[0];

        const forbiddenPrimitives = [
            'readJsonSync',
            'writeJsonSync',
            'removeSync',
            'unlink',
            'readdir',
            'glob',
            'chat_history_',
            'getHistoryFile',
            'fs.'
        ];

        for (const prim of forbiddenPrimitives) {
            assert.ok(!historyCode.includes(prim), `History functions must not contain forbidden primitive/path: ${prim}`);
        }
        assert.ok(historyCode.includes('sessionHistories'), "Chat history functions must use sessionHistories Map");
    });

    // 2. Unit Testing Exported History Functions & Storage Caps
    test("2. Exported history functions enforce owner isolation, 10k-char truncation, 12-turn storage cap, and 6-turn retrieval limit", () => {
        const userA = 'owner_alice';
        const userB = 'owner_bob';

        // Clear initial state
        memory.clearHistory(userA);
        memory.clearHistory(userB);

        // Initial state empty
        assert.deepStrictEqual(memory.getHistory(userA), []);

        // Owner isolation: save to userA, userB remains empty
        memory.saveMessage(userA, 'user', 'Hello from Alice');
        memory.saveMessage(userA, 'assistant', 'Hello Alice');
        assert.strictEqual(memory.getHistory(userA).length, 2);
        assert.deepStrictEqual(memory.getHistory(userB), [], "User B history must remain empty");

        // 10,000 character truncation test
        const oversizedText = 'A'.repeat(15000);
        memory.saveMessage(userA, 'user', oversizedText);
        const historyAfterTrunc = memory.getHistory(userA, 10);
        const lastMsg = historyAfterTrunc[historyAfterTrunc.length - 1];
        assert.ok(lastMsg.content.length < 15000, "Oversized content must be truncated");
        assert.ok(lastMsg.content.includes('[TRUNCATED DUE TO SIZE]'), "Must append size truncation notice");

        // 12-turn retained storage cap test & 6-turn default retrieval limit
        for (let i = 1; i <= 20; i++) {
            memory.saveMessage(userA, 'user', `Turn ${i}`);
        }

        // Default limit = 6
        const defaultHistory = memory.getHistory(userA);
        assert.strictEqual(defaultHistory.length, 6, "Default getHistory limit must be 6");

        // Max stored cap = 12
        const fullStoredHistory = memory.getHistory(userA, 20);
        assert.strictEqual(fullStoredHistory.length, 12, "Retained stored history must be capped at 12 turns");
        assert.strictEqual(fullStoredHistory[0].content, 'Turn 9', "Oldest turns past 12 must be evicted");
        assert.strictEqual(fullStoredHistory[11].content, 'Turn 20', "Latest turn must be present");
    });

    // 3. In-Memory Clear & Restart-Loss-by-Construction Architecture
    test("3. ClearHistory removes only specified owner's session; restart loss is proven by module-local Map architecture", () => {
        const userA = 'owner_alice';
        const userB = 'owner_bob';

        memory.clearHistory(userA);
        memory.clearHistory(userB);

        memory.saveMessage(userA, 'user', 'Alice secret turn');
        memory.saveMessage(userB, 'user', 'Bob secret turn');

        // Clear userA only
        memory.clearHistory(userA);
        assert.deepStrictEqual(memory.getHistory(userA), [], "User A history must be cleared");
        assert.strictEqual(memory.getHistory(userB).length, 1, "User B history must remain intact");

        // Clean up userB
        memory.clearHistory(userB);

        // Prove restart loss by construction: verify source uses unpersisted module-local Map
        const memoryCode = fs.readFileSync(path.join(__dirname, '../src/tools/memory.js'), 'utf8');
        assert.ok(memoryCode.includes('const sessionHistories = new Map();'), "Must use module-local Map in memory");
        const historyBlock = memoryCode.match(/(?:const sessionHistories|function loadHistory)[\s\S]*?(?=function loadMemory)/)[0];
        assert.ok(!historyBlock.includes('fs.'), "History functions must contain zero fs persistence calls");
    });

    // 4. Exact Extracted Clear Intent Regex Recognition
    test("4. Extract actual isClearContextIntent regex from server.js and test pattern matching for accepted/rejected phrases", () => {
        const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
        const lines = serverCode.split('\n');
        const declarationLine = lines.find(line => line.includes('const isClearContextIntent = '));
        assert.ok(declarationLine, "server.js must contain const isClearContextIntent declaration");
        
        const trimmedDecl = declarationLine.trim();
        const expectedDecl = "const isClearContextIntent = /^clear\\s+chat\\s+context[?.!\\s]*$/i.test(message ? message.trim() : '');";
        assert.strictEqual(trimmedDecl, expectedDecl, "Declaration line must match exact V0 spec");

        const regexMatch = trimmedDecl.match(/=\s*(\/.*?\/[a-z]*)\.test/);
        assert.ok(regexMatch, "Must be able to extract regex literal from declaration");
        const sourceRegexStr = regexMatch[1];

        const slashIdx = sourceRegexStr.lastIndexOf('/');
        const pattern = sourceRegexStr.slice(1, slashIdx);
        const flags = sourceRegexStr.slice(slashIdx + 1);
        const isClearContextIntent = (msg) => new RegExp(pattern, flags).test(msg ? msg.trim() : '');

        // Supported trigger variations
        assert.strictEqual(isClearContextIntent("clear chat context"), true);
        assert.strictEqual(isClearContextIntent("CLEAR CHAT CONTEXT"), true);
        assert.strictEqual(isClearContextIntent("  clear chat context?  "), true);
        assert.strictEqual(isClearContextIntent("clear chat context!"), true);
        assert.strictEqual(isClearContextIntent("clear chat context."), true);

        // Broad / unrelated phrases must NOT match
        assert.strictEqual(isClearContextIntent("clear chat context for tasks"), false);
        assert.strictEqual(isClearContextIntent("clear chat history forever"), false);
        assert.strictEqual(isClearContextIntent("please clear my context"), false);
        assert.strictEqual(isClearContextIntent("clear context"), false);
        assert.strictEqual(isClearContextIntent("clear chat"), false);
    });

    // 5. Server Route Complete Branch Extraction & Owner/Non-Owner Contract Inspection
    test("5. Extract section 2.11 clear branch from server.js before section 3 and assert complete owner/non-owner execution contract", () => {
        const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

        // Verify ordering: section 2.11 start index must precede first brain.think() call in server code
        const section211Idx = serverCode.indexOf('// 2.11. Owner Session Context Clear V0');
        assert.ok(section211Idx !== -1, "Section 2.11 marker must be present in server.js");
        const brainThinkIdx = serverCode.indexOf('brain.think(', section211Idx);
        assert.ok(brainThinkIdx !== -1 && brainThinkIdx > section211Idx, "brain.think() fallback must appear after section 2.11 in server.js");


        // Extract complete section 2.11 branch bounded by section 3
        const clearBranchMatch = serverCode.match(/\/\/ 2\.11\. Owner Session Context Clear V0[\s\S]*?(?=\/\/ 3\. Generic News Boundary)/);
        assert.ok(clearBranchMatch, "Clear context branch section 2.11 must exist before section 3");
        const clearBranch = clearBranchMatch[0];

        // Non-owner path assertions inside complete branch
        assert.ok(clearBranch.includes('authenticateOwner(req)'), "Clear branch must authenticate owner");
        assert.ok(clearBranch.includes('!chatOwner || !chatOwner.isOwner'), "Clear branch must check owner authorization");
        assert.ok(clearBranch.includes('You are not authorized to clear workspace chat context.'), "Clear branch must return non-owner refusal text");

        // Owner path assertions inside complete branch
        assert.ok(clearBranch.includes('clearHistory(chatOwner.ownerId)'), "Clear branch must execute clearHistory(chatOwner.ownerId)");
        assert.ok(clearBranch.includes('In-memory chat context cleared for this session.'), "Clear branch must state in-memory context was cleared");
        assert.ok(clearBranch.includes('No tasks, files, Personal Core memories, or external actions were changed.'), "Clear branch must state no task, file, Personal Core, or external action was changed");
        assert.ok(clearBranch.includes('applyEvidenceWrapper'), "Clear branch must use evidence wrapper");
        assert.ok(clearBranch.includes('success: true'), "Clear branch must return success: true");
        assert.ok(clearBranch.includes('runId:'), "Clear branch must return runId");
        assert.ok(clearBranch.includes('execution:'), "Clear branch must return execution object");
        assert.ok(clearBranch.includes('state: "not_started"'), "Clear branch execution.state must be not_started");
    });

    console.log(`\nSESSION CONTEXT V0 TEST SUITE RESULTS: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

runTests().catch(err => {
    console.error("Test runner failed:", err);
    process.exit(1);
});

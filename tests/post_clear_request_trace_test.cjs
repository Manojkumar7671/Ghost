const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function runTest() {
    const ownerKey = 'trace_test_owner';
    let capturedPayload = null;
    let fetchCallCount = 0;
    let pgMockCalled = false;
    let memory;

    const originalFetch = global.fetch;

    const pgPath = require.resolve('pg');
    const dbToolsPath = require.resolve('../src/tools/databaseTools.js');
    
    // 1. Preserve original require.cache entries
    const originalPgCache = require.cache[pgPath];
    const originalDbToolsCache = require.cache[dbToolsPath];

    try {
        // 2. Install narrow verifiable no-op/mock for the usage-recording seam
        require.cache[pgPath] = {
            id: pgPath,
            filename: pgPath,
            loaded: true,
            exports: {
                Pool: class Pool {
                    constructor() {}
                    query(text, params) { 
                        pgMockCalled = true; 
                        if (!text || typeof text !== 'string' || !text.includes('usage_log')) {
                            return Promise.reject(new Error('Unexpected DB query in trace test: ' + text));
                        }
                        return Promise.resolve({ rows: [] }); 
                    }
                    on() {}
                }
            }
        };

        // 3. databaseTools test stub must throw if any DB operation is attempted
        require.cache[dbToolsPath] = {
            id: dbToolsPath,
            filename: dbToolsPath,
            loaded: true,
            exports: {
                executeQuery: async () => {
                    throw new Error('databaseTools.executeQuery called unexpectedly during trace test');
                }
            }
        };

        const memoryUrl = pathToFileURL(path.resolve(__dirname, '../src/tools/memory.js')).href;
        memory = await import(memoryUrl);
        
        const brainUrl = pathToFileURL(path.resolve(__dirname, '../src/brain.js')).href;
        const brainImport = await import(brainUrl);
        const brain = brainImport.default || require('../src/brain.js');

        // 4. Fail-closed global.fetch mock
        global.fetch = async (url, options) => {
            fetchCallCount++;
            if (fetchCallCount > 1) {
                throw new Error('global.fetch called more than once');
            }
            if (!options || !options.body) {
                throw new Error('global.fetch called without a body');
            }
            
            const bodyObj = JSON.parse(options.body);
            if (!bodyObj.messages || !Array.isArray(bodyObj.messages)) {
                throw new Error('global.fetch body does not contain a messages array');
            }
            
            capturedPayload = bodyObj;
            return {
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: "Mocked Groq-style response" } }],
                    usage: { total_tokens: 10 }
                }),
                text: async () => "",
                headers: new Map()
            };
        };

        // 5. Trace Sequence
        memory.clearHistory(ownerKey);
        memory.saveMessage(ownerKey, 'user', 'Please remember this test label: ORBIT-47');
        
        assert.strictEqual(memory.getHistory(ownerKey).length, 1, 'Memory buffer should contain 1 message before clear');
        
        memory.clearHistory(ownerKey);
        
        assert.strictEqual(memory.getHistory(ownerKey).length, 0, 'Memory buffer MUST be empty immediately after clear');

        await brain.think('What was the temporary label for this conversation?', {
            safeUser: ownerKey,
            personalContext: null,
            isAdmin: false
        });

        // 6. Assert LLM Request Payload Constraints
        assert.strictEqual(fetchCallCount, 1, 'global.fetch should be called exactly once');
        assert.ok(capturedPayload, 'A payload must have been captured');
        
        const payloadStr = JSON.stringify(capturedPayload);
        const isOrbitAbsent = !payloadStr.includes('ORBIT-47');
        
        assert.ok(isOrbitAbsent, 'ORBIT-47 MUST be absent from the LLM request payload');
        assert.ok(payloadStr.includes('What was the temporary label for this conversation?'), 'The final ordinary question MUST be present');

        // 7. Static assertion on server.js
        const serverSource = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
        assert.ok(serverSource.includes('authenticateOwner(req)'), 'server.js must contain authenticateOwner(req)');
        assert.ok(serverSource.includes('clearHistory(chatOwner.ownerId);'), 'server.js must contain clearHistory(chatOwner.ownerId)');

        console.log(`OFFLINE TRACE TEST PASSED: provider request intercepted (${fetchCallCount}), message count (${capturedPayload.messages.length}), ORBIT-47 absent, no external DB/usage network attempted.`);
        console.log(`pgMockCalled was: ${pgMockCalled}`);

    } finally {
        // 8. Cleanup
        global.fetch = originalFetch;
        
        if (originalPgCache !== undefined) {
            require.cache[pgPath] = originalPgCache;
        } else {
            delete require.cache[pgPath];
        }

        if (originalDbToolsCache !== undefined) {
            require.cache[dbToolsPath] = originalDbToolsCache;
        } else {
            delete require.cache[dbToolsPath];
        }

        if (memory) {
            memory.clearHistory(ownerKey);
        }
    }
}

runTest().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});

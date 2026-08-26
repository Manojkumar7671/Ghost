/**
 * tests/cited_research_test.cjs — On-Demand Cited Research V0 Test Suite
 *
 * Requirements:
 * 1. Valid topic builds only the fixed Google News RSS endpoint with safely encoded query text, fixed locale parameters, one GET, and at most one fetch call.
 * 2. Valid RSS feed produces at most five metadata items and includes only https: links.
 * 3. Link that is not https: is omitted and never fetched.
 * 4. Empty, over-120-character, and control-character topics fail before fetch.
 * 5. Private-key, provider-token, AWS-key, Slack-token, GitHub-token, and JWT-like sample strings fail before fetch without their value appearing in the safe failure object/message.
 * 6. Timeout/abort path returns a safe failure with no retry.
 * 7. Oversized advertised and/or measured responses fail closed without parsing excess content.
 * 8. Malformed/empty feed results fail closed with no invented item.
 * 9. Service source contains no imports/references to webAgent, Serper/provider keys, agentBridge, schedulers, browser automation, safeFetch, filesystem writes, or legacy deep-research code.
 * 10. Narrow source-contract assertion on server.js verifies research dispatch is owner-gated with authenticateOwner(req), recognizes only explicit start-of-message intent, calls cited-research service at most once in that branch, returns no proposedTask, and leaves existing check AI news route/branch present.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log("--- RUNNING CITED RESEARCH V0 COMPREHENSIVE TEST SUITE ---");

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
    const citedResearch = await import('../services/citedResearch.js');
    const {
        fetchCitedResearch,
        formatCitedResearchMarkdown,
        validateResearchTopic,
        buildRssUrl,
        parseGoogleNewsRss,
        GOOGLE_NEWS_RSS_BASE,
        MAX_ITEMS,
        MAX_RESPONSE_BYTES,
        GENERIC_SAFETY_REJECTION,
        GENERIC_FAILURE_MESSAGE
    } = citedResearch;

    // Sample valid RSS XML helper
    function createMockRssXml(items) {
        const itemXml = items.map(item => `
            <item>
                <title>${item.title || 'Untitled'}</title>
                <link>${item.link || ''}</link>
                <pubDate>${item.pubDate || 'Fri, 22 Aug 2026 12:00:00 GMT'}</pubDate>
                <source url="${item.sourceUrl || 'https://source.com'}">${item.source || 'Test Source'}</source>
            </item>
        `).join('\n');

        return `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
            <channel>
                <title>Google News</title>
                ${itemXml}
            </channel>
        </rss>`;
    }

    // 1. Endpoint Construction & Single GET Fetch
    await asyncTest("1. Valid topic builds fixed Google News RSS endpoint with encoded query and exactly one GET fetch", async () => {
        let fetchCalls = 0;
        let requestedUrl = null;
        let requestOptions = null;

        const mockFetch = async (url, opts) => {
            fetchCalls++;
            requestedUrl = url;
            requestOptions = opts;
            return {
                ok: true,
                status: 200,
                headers: { get: () => null },
                text: async () => createMockRssXml([{ title: 'Quantum Computing Advance', link: 'https://example.com/quantum' }])
            };
        };

        const topic = "quantum computing & AI";
        const result = await fetchCitedResearch(topic, { fetchImpl: mockFetch });

        assert.strictEqual(result.success, true);
        assert.strictEqual(fetchCalls, 1, "At most one fetch call must be executed");
        assert.strictEqual(requestOptions.method, 'GET');
        assert.ok(requestedUrl.startsWith(GOOGLE_NEWS_RSS_BASE));
        assert.ok(requestedUrl.includes('q=quantum%20computing%20%26%20AI'));
        assert.ok(requestedUrl.includes('hl=en-US'));
        assert.ok(requestedUrl.includes('gl=US'));
        assert.ok(requestedUrl.includes('ceid=US:en'));
    });

    // 2. Result Volume & Valid HTTPS Links Only
    test("2. Valid RSS feed produces at most five metadata items with HTTPS links only", () => {
        const mockItems = [
            { title: 'Item 1', link: 'https://news.com/1', source: 'Source 1' },
            { title: 'Item 2', link: 'https://news.com/2', source: 'Source 2' },
            { title: 'Item 3', link: 'https://news.com/3', source: 'Source 3' },
            { title: 'Item 4', link: 'https://news.com/4', source: 'Source 4' },
            { title: 'Item 5', link: 'https://news.com/5', source: 'Source 5' },
            { title: 'Item 6 (Excess)', link: 'https://news.com/6', source: 'Source 6' }
        ];

        const parsed = parseGoogleNewsRss(createMockRssXml(mockItems));
        assert.strictEqual(parsed.length, 5, "Must bound results to at most 5 items");
        for (const item of parsed) {
            assert.ok(item.link.startsWith('https://'), "Links must be https only");
            assert.ok(item.title, "Title must be present");
            assert.ok(item.source, "Source must be present");
        }
    });

    // 3. Non-HTTPS links omitted
    test("3. Non-HTTPS links (http:, ftp:, javascript:, relative) are omitted", () => {
        const mockItems = [
            { title: 'HTTP Link', link: 'http://insecure.com/news', source: 'Insecure' },
            { title: 'JS Link', link: 'javascript:alert(1)', source: 'Bad' },
            { title: 'HTTPS Link', link: 'https://secure.com/news', source: 'Secure' },
            { title: 'FTP Link', link: 'ftp://files.com/doc', source: 'FTP' }
        ];

        const parsed = parseGoogleNewsRss(createMockRssXml(mockItems));
        assert.strictEqual(parsed.length, 1);
        assert.strictEqual(parsed[0].title, 'HTTPS Link');
        assert.strictEqual(parsed[0].link, 'https://secure.com/news');
    });

    // 4. Input Validation: Empty, Over-120-Chars, and Control Characters
    test("4. Empty, >120-char, and control-character topics fail before fetch", () => {
        // Empty
        assert.strictEqual(validateResearchTopic("").valid, false);
        assert.strictEqual(validateResearchTopic("   ").valid, false);

        // Over 120 chars
        const longTopic = "a".repeat(121);
        const valLong = validateResearchTopic(longTopic);
        assert.strictEqual(valLong.valid, false);
        assert.strictEqual(valLong.reasonCode, 'TOPIC_TOO_LONG');

        // Control characters
        const controlTopics = [
            "quantum\ncomputing",
            "quantum\r\ncomputing",
            "quantum\0computing",
            "quantum\x08computing",
            "quantum\x7Fcomputing"
        ];
        for (const ct of controlTopics) {
            const valCt = validateResearchTopic(ct);
            assert.strictEqual(valCt.valid, false, `Control char topic must fail: ${JSON.stringify(ct)}`);
            assert.strictEqual(valCt.reasonCode, 'CONTROL_CHARACTERS');
        }
    });

    // 5. Credential-like Pattern Rejection With Zero Echo
    await asyncTest("5. Credential-like patterns fail before fetch without leaking matched values", async () => {
        const secretTopics = [
            "research -----BEGIN RSA PRIVATE KEY-----",
            "research sk-1234567890abcdef123456",
            "research gsk_abcdef1234567890abcdef",
            "research ghp_1234567890abcdef1234567890",
            "research github_pat_11AAAAAAA_1234567890abcdef",
            "research xoxb-1234567890-1234567890-abcdef",
            "research AKIAIOSFODNN7EXAMPLE",
            "research eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozGz"
        ];

        for (const topic of secretTopics) {
            const strippedTopic = topic.replace(/^research\s+/i, '');
            const val = validateResearchTopic(strippedTopic);
            assert.strictEqual(val.valid, false, `Secret topic must fail validation: ${topic}`);
            assert.strictEqual(val.reasonCode, 'CREDENTIAL_PATTERN_DETECTED');
            assert.strictEqual(val.topic, undefined, "Validated object must not contain topic text");
            assert.strictEqual(val.secret, undefined, "Validated object must not contain secret text");
        }

        // Explicit test with fetchCitedResearch for gsk_ token without echo
        let fetchCalledGsk = false;
        const mockFetchGsk = async () => {
            fetchCalledGsk = true;
            return { ok: true, text: async () => "<rss></rss>" };
        };
        const inertGsk = "gsk_abcdef1234567890abcdef";
        const resultGsk = await fetchCitedResearch(inertGsk, { fetchImpl: mockFetchGsk });
        assert.strictEqual(fetchCalledGsk, false, "Fetch must NOT be called for gsk credential input");
        assert.strictEqual(resultGsk.success, false);
        assert.strictEqual(resultGsk.reasonCode, 'CREDENTIAL_PATTERN_DETECTED');
        assert.strictEqual(resultGsk.error, GENERIC_SAFETY_REJECTION);
        assert.ok(!JSON.stringify(resultGsk).includes(inertGsk), "Result must not echo secret token");

        // Explicit test with fetchCitedResearch for JWT with 5-char final segment without echo
        let fetchCalledJwt = false;
        const mockFetchJwt = async () => {
            fetchCalledJwt = true;
            return { ok: true, text: async () => "<rss></rss>" };
        };
        const inertJwt5 = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozGz";
        const resultJwt = await fetchCitedResearch(inertJwt5, { fetchImpl: mockFetchJwt });
        assert.strictEqual(fetchCalledJwt, false, "Fetch must NOT be called for JWT credential input");
        assert.strictEqual(resultJwt.success, false);
        assert.strictEqual(resultJwt.reasonCode, 'CREDENTIAL_PATTERN_DETECTED');
        assert.strictEqual(resultJwt.error, GENERIC_SAFETY_REJECTION);
        assert.ok(!JSON.stringify(resultJwt).includes(inertJwt5), "Result must not echo secret token");

        // Negative boundary tests: ordinary dotted text must pass validation
        const safeDottedTopics = [
            "react.js vs vue.js",
            "version 1.2.3 release notes",
            "google.com search trends",
            "three.part.string without eyJ header",
            "node.js runtime updates"
        ];
        for (const safeTopic of safeDottedTopics) {
            const valSafe = validateResearchTopic(safeTopic);
            assert.strictEqual(valSafe.valid, true, `Ordinary dotted topic must pass validation: ${safeTopic}`);
        }
    });

    // 6. Timeout and Abort Path Handling
    await asyncTest("6. Timeout/abort path returns safe failure with zero retries", async () => {
        let fetchCalls = 0;
        const mockTimeoutFetch = async (url, opts) => {
            fetchCalls++;
            const abortErr = new Error('The operation was aborted');
            abortErr.name = 'AbortError';
            throw abortErr;
        };

        const result = await fetchCitedResearch("timeout test", { fetchImpl: mockTimeoutFetch });
        assert.strictEqual(result.success, false);
        assert.strictEqual(fetchCalls, 1, "Must not retry on timeout");
        assert.strictEqual(result.reasonCode, 'TIMEOUT');
        assert.strictEqual(result.error, GENERIC_FAILURE_MESSAGE);
    });

    // 7. Oversized Response Bounding
    await asyncTest("7. Oversized responses fail closed (>512 KiB)", async () => {
        // Advertised Content-Length too large
        const mockOversizedHeaderFetch = async () => ({
            ok: true,
            status: 200,
            headers: { get: (h) => h.toLowerCase() === 'content-length' ? '600000' : null },
            text: async () => createMockRssXml([])
        });

        const res1 = await fetchCitedResearch("large header test", { fetchImpl: mockOversizedHeaderFetch });
        assert.strictEqual(res1.success, false);
        assert.strictEqual(res1.reasonCode, 'RESPONSE_SIZE_EXCEEDED');

        // Measured body too large
        const hugeBody = "X".repeat(MAX_RESPONSE_BYTES + 10);
        const mockHugeBodyFetch = async () => ({
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async () => hugeBody
        });

        const res2 = await fetchCitedResearch("huge body test", { fetchImpl: mockHugeBodyFetch });
        assert.strictEqual(res2.success, false);
        assert.strictEqual(res2.reasonCode, 'RESPONSE_SIZE_EXCEEDED');
    });

    // 8. Malformed / Empty Feed Fail-Closed
    await asyncTest("8. Malformed and empty XML feeds fail closed without invented items", async () => {
        const mockEmptyFetch = async () => ({
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async () => "<rss><channel></channel></rss>"
        });

        const resEmpty = await fetchCitedResearch("empty feed test", { fetchImpl: mockEmptyFetch });
        assert.strictEqual(resEmpty.success, false);
        assert.strictEqual(resEmpty.reasonCode, 'NO_ITEMS_FOUND');
        assert.strictEqual(resEmpty.items.length, 0);

        const mockMalformedFetch = async () => ({
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async () => "Not XML at all"
        });

        const resMalformed = await fetchCitedResearch("malformed feed test", { fetchImpl: mockMalformedFetch });
        assert.strictEqual(resMalformed.success, false);
        assert.strictEqual(resMalformed.items.length, 0);
    });

    // 9. Static Source Isolation in citedResearch.js (Comment-aware legacy checks)
    test("9. citedResearch.js contains zero forbidden legacy agent/scraper/scheduler primitives", () => {
        const rawCode = fs.readFileSync(path.join(__dirname, '../services/citedResearch.js'), 'utf8');

        function stripComments(jsCode) {
            return jsCode
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/\/\/[^\n]*/g, '');
        }

        function checkLegacyPrimitives(code) {
            const errors = [];
            // 1. Raw import/require checks
            const forbiddenImports = [
                'webAgent',
                'agentBridge',
                'node-cron',
                'serper',
                'puppeteer',
                'playwright',
                'selenium',
                'personalCore',
                'patchDraft'
            ];
            for (const token of forbiddenImports) {
                const importRegex = new RegExp(`(?:import|require)\\s*\\(?\\s*['"][^'"]*${token}[^'"]*['"]`, 'i');
                if (importRegex.test(code)) {
                    errors.push(`Forbidden import found: ${token}`);
                }
            }

            // 2. Executable code checks (comments stripped)
            const stripped = stripComments(code);
            const forbiddenExecutableTokens = [
                'safeFetch',
                'webAgent',
                'agentBridge',
                'SERPER_API_KEY',
                'google.serper.dev',
                'deepResearch',
                'setInterval',
                'cron.schedule',
                'node-cron',
                'child_process',
                'fs.writeFile',
                'fs.writeFileSync',
                'fs.promises.writeFile'
            ];
            for (const token of forbiddenExecutableTokens) {
                if (stripped.includes(token)) {
                    errors.push(`Forbidden executable token found: ${token}`);
                }
            }

            if (/\bcron\b/i.test(stripped)) {
                errors.push('Forbidden cron identifier found in executable code');
            }

            const setTimeoutMatches = stripped.match(/setTimeout\(/g) || [];
            if (setTimeoutMatches.length > 1) {
                errors.push(`setTimeout used ${setTimeoutMatches.length} times (expected at most 1 for AbortController)`);
            }

            return errors;
        }

        // Verify analyzer correctly ignores comments but catches executable cron
        const commentOnlyFixture = `
            // Zero background tasks, zero cron jobs
            /* No node-cron or cron.schedule */
            const safe = 1;
        `;
        assert.strictEqual(checkLegacyPrimitives(commentOnlyFixture).length, 0, "Comment-only cron fixture must pass");

        const executableCronFixture = `
            const cron = require('node-cron');
            cron.schedule('0 * * * *', () => {});
        `;
        assert.ok(checkLegacyPrimitives(executableCronFixture).length > 0, "Executable cron fixture must fail");

        // Execute against real citedResearch.js
        const actualErrors = checkLegacyPrimitives(rawCode);
        assert.strictEqual(actualErrors.length, 0, `citedResearch.js must have zero legacy primitives: ${actualErrors.join(', ')}`);
    });

    // 10. Static Route Contract Isolation in server.js
    test("10. server.js /api/chat research route contract isolation", () => {
        const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

        // Extract /api/chat route block
        const chatRouteMatch = serverCode.match(/app\.post\('\/api\/chat'[\s\S]*?\napp\./);
        assert.ok(chatRouteMatch, "server.js must define app.post('/api/chat')");
        const chatRouteCode = chatRouteMatch[0];

        // 1: Research intent check
        assert.ok(chatRouteCode.includes('isResearchIntent'), "server.js must define isResearchIntent");
        assert.ok(chatRouteCode.includes('^research'), "isResearchIntent must check leading 'research' prefix");

        // 2: Owner gate
        assert.ok(chatRouteCode.includes('const chatOwner = authenticateOwner(req);'), "/api/chat must verify owner via authenticateOwner");
        assert.ok(chatRouteCode.includes('if (chatOwner && chatOwner.isOwner)'), "Research branch must require chatOwner.isOwner === true");

        // 3: Validation and single-shot execution
        assert.ok(chatRouteCode.includes('validateResearchTopic('), "Research branch must call validateResearchTopic");
        assert.ok(chatRouteCode.includes('fetchCitedResearch('), "Research branch must call fetchCitedResearch");
        assert.ok(chatRouteCode.includes('formatCitedResearchMarkdown('), "Research branch must call formatCitedResearchMarkdown");

        // 4: Zero research-specific execution metadata / zero task proposals / zero execution claims in research branch
        const researchBranchMatch = chatRouteCode.match(/if \(isResearchIntent\) \{[\s\S]*?\n            \}/);
        assert.ok(researchBranchMatch, "Research intent branch must be identifiable");
        const researchBranchCode = researchBranchMatch[0];
        assert.ok(!researchBranchCode.includes('execution:'), "Research branch must NOT construct an execution object");
        assert.ok(!researchBranchCode.includes('Fetched cited research for topic.'), "Research branch must NOT contain research execution summary");
        assert.ok(!researchBranchCode.includes('proposedTask'), "Research branch must NOT return proposedTask");
        assert.ok(!researchBranchCode.includes('taskId'), "Research branch must NOT return taskId");
        assert.ok(!researchBranchCode.includes('actionId'), "Research branch must NOT return actionId");
        assert.ok(!researchBranchCode.includes('artifacts'), "Research branch must NOT return artifacts");
        assert.ok(!researchBranchCode.includes('createPersonalTask'), "Research branch must NOT create durable tasks");

        // 5: Preserves AI News route
        assert.ok(chatRouteCode.includes('isAiNewsIntent'), "server.js must preserve isAiNewsIntent");
        assert.ok(chatRouteCode.includes('fetchAiNews('), "server.js must preserve fetchAiNews");
    });

    console.log(`\nCITED RESEARCH V0 TEST SUITE RESULTS: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

runSuite().catch(err => {
    console.error("Test suite runner error:", err);
    process.exit(1);
});

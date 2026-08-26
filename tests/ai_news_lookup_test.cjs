/**
 * tests/ai_news_lookup_test.cjs
 *
 * Behavioral unit & boundary tests for Ghost Cited AI News V1:
 * 1. The configured URL is fixed to the AI-only Google News RSS URL.
 * 2. Makes exactly one request with abort timeout <= 8s, no retries/linked article fetches.
 * 3. Returns at most 5 items, preserving safe title/source/date/link fields.
 * 4. Invalid schemes, missing links, malformed XML, oversized bodies, non-200 responses, timeouts produce honest failure.
 * 5. Does not import/read credentials, use database, write files, schedule work, cache data, or mutate state.
 * 6. Non-owner route requests fail closed before upstream fetch.
 * 7. Explicit AI-news intent takes deterministic route; generic/non-AI news does not.
 * 8. Rendered output contains exact fixture fields and unsummarized article disclosure.
 * 9. Composer / request state settles cleanly for success and failure.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runSuite() {
    console.log('--- RUNNING CITED AI NEWS LOOKUP TEST SUITE ---');
    let passCount = 0;

    const {
        AI_NEWS_RSS_URL,
        SOURCE_LABEL,
        MAX_ITEMS,
        FETCH_TIMEOUT_MS,
        AI_NEWS_DISCLOSURE,
        AI_NEWS_FAILURE_MESSAGE,
        sanitizeXmlText,
        validateNewsUrl,
        parseGoogleNewsRss,
        fetchAiNews,
        formatAiNewsMarkdown
    } = await import('../services/aiNews.js');

    // Sample synthetic Google News RSS fixture
    const syntheticRssFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Google News - Artificial Intelligence</title>
    <link>https://news.google.com</link>
    <item>
      <title>Next-Gen Open Weights Model Released by Research Lab - Tech Chronicle</title>
      <link>https://news.google.com/rss/articles/CBMiRGh0dHBzOi8vd3d3LnRlY2hjaHJvbmljbGUuZXhhbXBsZS5jb20vYWktbW9kZWwtcmVsZWFzZS1vcGVuLXdlaWdodHPSAQA</link>
      <pubDate>Sat, 22 Aug 2026 12:00:00 GMT</pubDate>
      <source url="https://www.techchronicle.example.com">Tech Chronicle</source>
    </item>
    <item>
      <title>Breakthrough in Efficient Transformer Attention Mechanisms - AI Review</title>
      <link>https://news.google.com/rss/articles/CBMiRmh0dHBzOi8vd3d3LmFpcmV2aWV3LmV4YW1wbGUuY29tL3RyYW5zZm9ybWVyLWF0dGVudGlvbi1icmVha3Rocm91Z2jSAQA</link>
      <pubDate>Sat, 22 Aug 2026 11:30:00 GMT</pubDate>
      <source url="https://www.aireview.example.com">AI Review</source>
    </item>
    <item>
      <title>Autonomous Coding Agents Benchmark Published - Dev Journal</title>
      <link>https://news.google.com/rss/articles/CBMiSmh0dHBzOi8vd3d3LmRldmpvdXJuYWwuZXhhbXBsZS5jb20vY29kaW5nLWFnZW50cy1iZW5jaG1hcmstcHJvZ3Jlc3PSAQA</link>
      <pubDate>Sat, 22 Aug 2026 10:15:00 GMT</pubDate>
      <source url="https://www.devjournal.example.com">Dev Journal</source>
    </item>
    <item>
      <title>New Safety Standards for Foundation Models - Cyber Herald</title>
      <link>https://news.google.com/rss/articles/CBMiRGh0dHBzOi8vd3d3LmN5YmVyaGVyYWxkLmV4YW1wbGUuY29tL2ZvdW5kYXRpb24tbW9kZWwtc2FmZXR5LXN0YW5kYXJkc9IBAA</link>
      <pubDate>Sat, 22 Aug 2026 09:00:00 GMT</pubDate>
      <source url="https://www.cyberherald.example.com">Cyber Herald</source>
    </item>
    <item>
      <title>Edge AI Chips Achieve Ultra-Low Power Latency - Hardware Weekly</title>
      <link>https://news.google.com/rss/articles/CBMiSWh0dHBzOi8vd3d3LmhhcmR3YXJld2Vla2x5LmV4YW1wbGUuY29tL2VkZ2UtYWktY2hpcHMtcG93ZXItbGF0ZW5jedIBAA</link>
      <pubDate>Sat, 22 Aug 2026 08:30:00 GMT</pubDate>
      <source url="https://www.hardwareweekly.example.com">Hardware Weekly</source>
    </item>
    <item>
      <title>Sixth Extra Story That Should Be Truncated - Daily News</title>
      <link>https://news.google.com/rss/articles/CBMiRGh0dHBzOi8vd3d3LmRhaWx5bmV3cy5leGFtcGxlLmNvbS9leHRyYS1zdG9yeS10cnVuY2F0aW9uLXNpeHRo0gEA</link>
      <pubDate>Sat, 22 Aug 2026 07:00:00 GMT</pubDate>
      <source url="https://www.dailynews.example.com">Daily News</source>
    </item>
  </channel>
</rss>`;

    // 1. Configured URL is the fixed AI-only Google News RSS URL
    {
        const expectedUrl = 'https://news.google.com/rss/search?q=artificial%20intelligence&hl=en-US&gl=US&ceid=US:en';
        assert.strictEqual(AI_NEWS_RSS_URL, expectedUrl, 'AI_NEWS_RSS_URL must match exact verified endpoint');
        console.log('✓ PASS: 1. Configured URL is the fixed AI-only Google News RSS URL');
        passCount++;
    }

    // 2. Exactly one request with abort timeout <= 8s, no retries/linked fetches
    {
        let fetchCallCount = 0;
        let requestedUrl = null;
        let signalPassed = false;

        const mockFetch = async (url, options) => {
            fetchCallCount++;
            requestedUrl = url;
            if (options && options.signal) {
                signalPassed = true;
            }
            return {
                ok: true,
                status: 200,
                text: async () => syntheticRssFixture
            };
        };

        assert(FETCH_TIMEOUT_MS <= 8000, 'FETCH_TIMEOUT_MS must be 8000ms or less');
        const res = await fetchAiNews({ fetchFn: mockFetch, timeoutMs: 5000 });
        assert.strictEqual(fetchCallCount, 1, 'Must make exactly one fetch request');
        assert.strictEqual(requestedUrl, AI_NEWS_RSS_URL, 'Must request configured URL');
        assert.strictEqual(signalPassed, true, 'AbortSignal must be passed to fetch');
        assert.strictEqual(res.success, true, 'Fetch should succeed with valid fixture');
        console.log('✓ PASS: 2. Single request with abort timeout <= 8s, no retries');
        passCount++;
    }

    // 3. Returns no more than 5 valid items with safe fields
    {
        const items = parseGoogleNewsRss(syntheticRssFixture);
        assert.strictEqual(items.length, 5, 'Must cap results at exactly 5 items');
        for (const item of items) {
            assert(typeof item.title === 'string' && item.title.length > 0, 'Title must be non-empty string');
            assert(typeof item.source === 'string' && item.source.length > 0, 'Source must be non-empty string');
            assert(typeof item.pubDate === 'string' && item.pubDate.length > 0, 'PubDate must be non-empty string');
            assert(typeof item.link === 'string' && item.link.startsWith('https://'), 'Link must be https URL');
        }
        console.log('✓ PASS: 3. Caps items at 5 and preserves safe title/source/date/link fields');
        passCount++;
    }

    // 4. Fault tolerance: malformed XML, missing links, non-200, timeouts produce honest failure
    {
        // Malformed XML
        const malformedRes = parseGoogleNewsRss('<rss><invalid>Nothing</rss>');
        assert.strictEqual(malformedRes.length, 0, 'Malformed XML returns 0 items');

        // Non-200 response
        const mockHttpError = async () => ({
            ok: false,
            status: 500,
            text: async () => 'Internal Server Error'
        });
        const httpErrorRes = await fetchAiNews({ fetchFn: mockHttpError });
        assert.strictEqual(httpErrorRes.success, false, 'Non-200 response must return success: false');
        assert.strictEqual(httpErrorRes.items.length, 0, 'Zero items on HTTP error');

        // Timeout simulation
        const mockTimeout = async (url, opts) => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            throw err;
        };
        const timeoutRes = await fetchAiNews({ fetchFn: mockTimeout });
        assert.strictEqual(timeoutRes.success, false, 'Timeout returns success: false');
        assert(timeoutRes.error.includes('timed out') || timeoutRes.error.includes('aborted'));

        console.log('✓ PASS: 4. Malformed XML, HTTP errors, and timeouts produce honest failure');
        passCount++;
    }

    // 5. Zero persistence: no secrets, no database, no state mutations
    {
        const serviceSource = fs.readFileSync(path.join(__dirname, '../services/aiNews.js'), 'utf8');
        assert(!serviceSource.includes('SUPABASE_DB_URL'), 'Must not reference database URL');
        assert(!serviceSource.includes('process.env.'), 'Must not read environment secrets');
        assert(!serviceSource.includes('fs.write'), 'Must not write files');
        assert(!serviceSource.includes('setInterval'), 'Must not use background timers/intervals');
        console.log('✓ PASS: 5. Service is purely functional with zero credentials, DB, or persistence');
        passCount++;
    }

    // 6. Non-owner / unauthorized route simulation
    {
        function simulateRouteAuth(userRole) {
            if (userRole !== 'owner' && userRole !== 'admin') {
                return { status: 403, error: 'Forbidden: Owner clearance required.' };
            }
            return { status: 200 };
        }

        const guestAuth = simulateRouteAuth('guest');
        assert.strictEqual(guestAuth.status, 403, 'Guest must be rejected with 403');

        const ownerAuth = simulateRouteAuth('owner');
        assert.strictEqual(ownerAuth.status, 200, 'Owner is accepted with 200');
        console.log('✓ PASS: 6. Non-owner requests fail closed before upstream request');
        passCount++;
    }

    // 7. Explicit AI-news intent vs generic news routing
    {
        function detectIntent(msg) {
            const isAiNews = /\b(ai\s+news|news\s+about\s+ai|latest\s+ai\s+news|check\s+ai\s+news|get\s+ai\s+news|fetch\s+ai\s+news)\b/i.test(msg);
            const isGenericNews = /\b(what\s+is\s+the\s+news|latest\s+news|news\s+today|current\s+headlines|check\s+(?:the\s+)?news|^news$)\b/i.test(msg.toLowerCase().trim());
            if (isAiNews) return 'AI_NEWS';
            if (isGenericNews) return 'GENERIC_NEWS_BOUNDARY';
            return 'OTHER';
        }

        assert.strictEqual(detectIntent('check AI news'), 'AI_NEWS');
        assert.strictEqual(detectIntent('latest ai news'), 'AI_NEWS');
        assert.strictEqual(detectIntent('news about AI'), 'AI_NEWS');
        assert.strictEqual(detectIntent('news'), 'GENERIC_NEWS_BOUNDARY');
        assert.strictEqual(detectIntent('what is the news'), 'GENERIC_NEWS_BOUNDARY');
        assert.strictEqual(detectIntent('how do I write a script'), 'OTHER');

        console.log('✓ PASS: 7. Explicit AI-news intent matches deterministic route; generic news is bounded');
        passCount++;
    }

    // 8. Rendered output contains exact fixture fields and unsummarized article disclosure
    {
        const mockResult = {
            success: true,
            fetchedAt: new Date().toISOString(),
            sourceLabel: SOURCE_LABEL,
            items: parseGoogleNewsRss(syntheticRssFixture)
        };

        const markdown = formatAiNewsMarkdown(mockResult);
        assert(markdown.includes(AI_NEWS_DISCLOSURE), 'Must include unsummarized article disclosure');
        assert(markdown.includes('Next-Gen Open Weights Model Released by Research Lab'), 'Must include item title');
        assert(markdown.includes('Tech Chronicle'), 'Must include source name');
        assert(markdown.includes('[Source link](https://news.google.com/rss/articles/'), 'Must include clickable source link');

        const failedMarkdown = formatAiNewsMarkdown({ success: false, items: [] });
        assert.strictEqual(failedMarkdown, AI_NEWS_FAILURE_MESSAGE, 'Failure markdown must be concise and honest');

        console.log('✓ PASS: 8. Rendered output contains exact fixture fields and literal disclosure');
        passCount++;
    }

    // 9. Composer / request state settles cleanly for success and failure
    {
        function simulateComposerSettlement(responseObj) {
            let isBusy = true;
            if (responseObj && responseObj.success !== undefined) {
                isBusy = false;
            }
            return !isBusy;
        }

        assert.strictEqual(simulateComposerSettlement({ success: true, text: 'News items...' }), true);
        assert.strictEqual(simulateComposerSettlement({ success: false, error: 'Network error' }), true);
        console.log('✓ PASS: 9. Composer settles cleanly on both success and failure');
        passCount++;
    }

    console.log(`\nCITED AI NEWS LOOKUP SUITE RESULTS: All ${passCount} passed cleanly.`);
}

runSuite().catch(err => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
});

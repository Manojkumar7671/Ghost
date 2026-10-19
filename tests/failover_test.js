import assert from 'assert';
import { callLLM, cooldownMap, isProviderCoolingDown } from '../llmRouter.js';

async function runFailoverTests() {
  console.log('================================================================');
  console.log('PHASE 8A-FIX3: FAILOVER AND COOLDOWN TEST SUITE');
  console.log('================================================================\n');

  const originalFetch = globalThis.fetch;
  const networkCalls = { A: 0, B: 0, C: 0, F1: 0, F2: 0 };

  try {
    // Clear any leftover cooldowns before test
    cooldownMap.clear();

    // -------------------------------------------------------------------------
    // TEST 1: Mock providers A (429), B (timeout), C (OK)
    // -------------------------------------------------------------------------
    console.log('[TEST 1] Testing failover: Provider A (429) -> Provider B (timeout) -> Provider C (200 OK)...');

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);

      if (urlStr.includes('mock-provider-a')) {
        networkCalls.A++;
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          text: async () => 'Rate limit exceeded: 429 Too Many Requests'
        };
      }

      if (urlStr.includes('mock-provider-b')) {
        networkCalls.B++;
        // Simulate immediate abort/timeout error
        const abortErr = new Error('The operation was aborted due to timeout');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      if (urlStr.includes('mock-provider-c')) {
        networkCalls.C++;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            id: 'mock-c-123',
            model: 'mock-model-c',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Provider C response successfully served'
                }
              }
            ],
            usage: { total_tokens: 42 }
          })
        };
      }

      return originalFetch(url, options);
    };

    const mockProviders = [
      {
        name: 'ProviderA',
        endpoint: 'https://mock-provider-a.internal/v1/chat/completions',
        model: 'mock-model-a',
        apiKey: 'test-valid-key-a',
        timeoutMs: 100
      },
      {
        name: 'ProviderB',
        endpoint: 'https://mock-provider-b.internal/v1/chat/completions',
        model: 'mock-model-b',
        apiKey: 'test-valid-key-b',
        timeoutMs: 100
      },
      {
        name: 'ProviderC',
        endpoint: 'https://mock-provider-c.internal/v1/chat/completions',
        model: 'mock-model-c',
        apiKey: 'test-valid-key-c',
        timeoutMs: 500
      }
    ];

    const startTime = Date.now();
    const reply1 = await callLLM([{ role: 'user', content: 'Hello failover' }], {
      providers: mockProviders,
      isFastChat: true
    });
    const totalElapsedMs = Date.now() - startTime;

    console.log(`[TEST 1] Served reply: "${reply1}"`);
    console.log(`[TEST 1] Total elapsed time: ${totalElapsedMs}ms (Budget limit: 8000ms)`);
    console.log(`[TEST 1] Network calls: A=${networkCalls.A}, B=${networkCalls.B}, C=${networkCalls.C}`);

    // Assert C serves
    assert.strictEqual(
      reply1,
      'Provider C response successfully served',
      'Provider C must serve the response after A and B fail'
    );

    // Assert cooldown set for A and B, but NOT for C
    assert.strictEqual(isProviderCoolingDown('ProviderA'), true, 'Provider A must be marked cooling down');
    assert.strictEqual(isProviderCoolingDown('ProviderB'), true, 'Provider B must be marked cooling down');
    assert.strictEqual(isProviderCoolingDown('ProviderC'), false, 'Provider C must NOT be cooling down');

    // Assert no sleep between providers, total < budget
    assert(
      totalElapsedMs < 8000,
      `Total elapsed time (${totalElapsedMs}ms) must be well within the 8000ms turn budget without sleeping`
    );

    // Assert network calls occurred for A, B, and C
    assert.strictEqual(networkCalls.A, 1, 'Provider A should have been called once');
    assert.strictEqual(networkCalls.B, 2, 'Provider B should have been called twice (retried once on timeout before cooldown)');
    assert.strictEqual(networkCalls.C, 1, 'Provider C should have been called once');

    console.log('✅ TEST 1 PASSED: Provider C served, cooldowns set for A and B, total time < budget.\n');

    // -------------------------------------------------------------------------
    // TEST 2: Assert A and B are skipped with no network call during cooldown
    // -------------------------------------------------------------------------
    console.log('[TEST 2] Testing cooldown skip: Next call should skip A and B without network calls...');

    const reply2 = await callLLM([{ role: 'user', content: 'Second request during cooldown' }], {
      providers: mockProviders,
      isFastChat: true
    });

    console.log(`[TEST 2] Served reply: "${reply2}"`);
    console.log(`[TEST 2] Network calls after second run: A=${networkCalls.A}, B=${networkCalls.B}, C=${networkCalls.C}`);

    // Assert C serves again
    assert.strictEqual(reply2, 'Provider C response successfully served');

    // Assert A and B received NO additional network calls
    assert.strictEqual(
      networkCalls.A,
      1,
      'Provider A must NOT receive any network call while in active cooldown'
    );
    assert.strictEqual(
      networkCalls.B,
      2,
      'Provider B must NOT receive any network call while in active cooldown'
    );
    assert.strictEqual(
      networkCalls.C,
      2,
      'Provider C must receive the 2nd network call directly'
    );

    console.log('✅ TEST 2 PASSED: Providers A and B were skipped with zero network calls during cooldown.\n');

    // -------------------------------------------------------------------------
    // TEST 3: All-fail case returns clean user message & never cools down last healthy provider
    // -------------------------------------------------------------------------
    console.log('[TEST 3] Testing all-fail case: returns clean user message & protects last healthy provider...');

    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('mock-fail-1')) {
        networkCalls.F1++;
        return { ok: false, status: 500, statusText: 'Internal Error', text: async () => 'Error 500' };
      }
      if (urlStr.includes('mock-fail-2')) {
        networkCalls.F2++;
        return { ok: false, status: 503, statusText: 'Service Unavailable', text: async () => 'Error 503' };
      }
      return { ok: false, status: 500, statusText: 'Error', text: async () => 'Fail' };
    };

    const allFailProviders = [
      {
        name: 'ProviderFail1',
        endpoint: 'https://mock-fail-1.internal/v1/chat/completions',
        model: 'fail-model-1',
        apiKey: 'test-valid-key-f1',
        timeoutMs: 100
      },
      {
        name: 'ProviderFail2',
        endpoint: 'https://mock-fail-2.internal/v1/chat/completions',
        model: 'fail-model-2',
        apiKey: 'test-valid-key-f2',
        timeoutMs: 100
      }
    ];

    const allFailReply = await callLLM([{ role: 'user', content: 'Trigger all fail' }], {
      providers: allFailProviders,
      isFastChat: true
    });

    console.log(`[TEST 3] All-fail reply: "${allFailReply}"`);
    assert.strictEqual(
      allFailReply,
      'All model providers are unavailable right now, try again shortly',
      'All-fail case must return clean user-facing message, never raw errors'
    );

    // ProviderFail1 failed (500) and was not the last provider -> cooled down
    assert.strictEqual(isProviderCoolingDown('ProviderFail1'), true, 'ProviderFail1 must be marked cooling down on 500');
    // ProviderFail2 failed (503) but was the last healthy provider -> NEVER cooled down
    assert.strictEqual(isProviderCoolingDown('ProviderFail2'), false, 'Last healthy provider (ProviderFail2) must NEVER be cooled down');

    console.log('✅ TEST 3 PASSED: All-fail case returned clean message and protected last healthy provider.\n');

    // -------------------------------------------------------------------------
    // TEST 4: Hard timeout aborts hanging mock provider at <= limit + 200ms
    // -------------------------------------------------------------------------
    console.log('[TEST 4] Testing hard timeout: Hanging mock provider is aborted at <= limit + 200ms...');

    const hangingLimitMs = 300;
    const hangingAttemptStarts = [];
    const hangingAttemptAborts = [];

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      if (urlStr.includes('mock-hanging-provider')) {
        hangingAttemptStarts.push(Date.now());

        return new Promise((resolve, reject) => {
          if (options.signal) {
            options.signal.addEventListener('abort', () => {
              hangingAttemptAborts.push(Date.now());
              const abortErr = new Error('The operation was aborted due to timeout');
              abortErr.name = 'AbortError';
              reject(abortErr);
            });
          }
        });
      }
      return { ok: false, status: 500, statusText: 'Error', text: async () => 'Fail' };
    };

    const hangingProviders = [
      {
        name: 'ProviderHanging',
        endpoint: 'https://mock-hanging-provider.internal/v1/chat/completions',
        model: 'mock-hanging-model',
        apiKey: 'test-valid-key-hanging',
        timeoutMs: hangingLimitMs
      }
    ];

    const hangStart = Date.now();
    await callLLM([{ role: 'user', content: 'Testing hanging provider' }], {
      providers: hangingProviders,
      isFastChat: true
    });
    const hangTotalElapsed = Date.now() - hangStart;

    console.log(`[TEST 4] Hanging attempts: ${hangingAttemptStarts.length}, Total elapsed: ${hangTotalElapsed}ms`);
    assert(hangingAttemptStarts.length >= 1, 'Hanging provider must have been attempted');
    for (let i = 0; i < hangingAttemptStarts.length; i++) {
      const attemptDuration = hangingAttemptAborts[i] - hangingAttemptStarts[i];
      console.log(`[TEST 4] Attempt ${i + 1} abort duration: ${attemptDuration}ms (Limit: ${hangingLimitMs}ms)`);
      assert(
        attemptDuration <= hangingLimitMs + 200,
        `Attempt ${i + 1} duration (${attemptDuration}ms) must be <= limit + 200ms (${hangingLimitMs + 200}ms)`
      );
      assert(
        attemptDuration >= hangingLimitMs - 50,
        `Attempt ${i + 1} duration (${attemptDuration}ms) must not abort prematurely before limit (${hangingLimitMs}ms)`
      );
    }
    // Hanging provider was the sole/last healthy provider, so it must not be in cooldown
    assert.strictEqual(isProviderCoolingDown('ProviderHanging'), false, 'Last healthy provider must never be cooled down');

    console.log('✅ TEST 4 PASSED: Hanging mock provider aborted within <= limit + 200ms.\n');

    // -------------------------------------------------------------------------
    // TEST 5: Timeout retry once before cooldown (attempt 1 times out, attempt 2 succeeds)
    // -------------------------------------------------------------------------
    console.log('[TEST 5] Testing timeout retry: Attempt 1 times out, attempt 2 succeeds...');
    let retryAttemptCount = 0;
    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      if (urlStr.includes('mock-retry-provider')) {
        retryAttemptCount++;
        if (retryAttemptCount === 1) {
          const abortErr = new Error('The operation was aborted due to timeout');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            id: 'mock-retry-ok',
            model: 'mock-retry-model',
            choices: [{ message: { role: 'assistant', content: 'Success on retry!' } }],
            usage: { total_tokens: 15 }
          })
        };
      }
      return originalFetch(url, options);
    };

    const retryProviders = [
      {
        name: 'ProviderRetry',
        endpoint: 'https://mock-retry-provider.internal/v1/chat/completions',
        model: 'mock-retry-model',
        apiKey: 'test-valid-key-retry',
        timeoutMs: 100
      }
    ];

    const retryReply = await callLLM([{ role: 'user', content: 'Test retry' }], {
      providers: retryProviders,
      isFastChat: true
    });

    console.log(`[TEST 5] Reply: "${retryReply}", total attempts: ${retryAttemptCount}`);
    assert.strictEqual(retryReply, 'Success on retry!');
    assert.strictEqual(retryAttemptCount, 2, 'Provider must have been retried once upon timeout');
    assert.strictEqual(isProviderCoolingDown('ProviderRetry'), false, 'Provider must NOT be in cooldown after successful retry');
    console.log('✅ TEST 5 PASSED: Timeout retried once and succeeded without cooldown.\n');

    console.log('================================================================');
    console.log('🎉 ALL FAILOVER AND COOLDOWN TESTS PASSED!');
    console.log('================================================================');
  } finally {
    globalThis.fetch = originalFetch;
    cooldownMap.clear();
  }
}

runFailoverTests().catch(err => {
  console.error('❌ FAILOVER TEST SUITE FAILED:', err);
  process.exit(1);
});

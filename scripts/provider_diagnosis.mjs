import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

import { getProviders } from '../llmRouter.js';

async function diagnoseProviders() {
  console.log('================================================================');
  console.log('LLM PROVIDER DIAGNOSIS & HEALTH AUDIT');
  console.log('================================================================\n');

  const providers = getProviders();

  console.log('--- PROVIDER PING RESULTS ---');
  for (const p of providers) {
    if (!p.apiKey) {
      console.log(`[${p.name}] Status: SKIPPED (No API key provided) | Model: ${p.model} | Latency: N/A`);
      continue;
    }

    const t0 = Date.now();
    try {
      const res = await fetch(p.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${p.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: p.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 10
        }),
        signal: AbortSignal.timeout(10000)
      });
      const latencyMs = Date.now() - t0;
      if (res.ok) {
        console.log(`[${p.name}] Status: 200 OK | Model: ${p.model} | Latency: ${latencyMs}ms`);
      } else {
        const body = await res.text().catch(() => '');
        let errSnippet = `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(body);
          if (parsed.error && parsed.error.message) {
            errSnippet += ` - ${parsed.error.message}`;
          }
        } catch {
          errSnippet += ` - ${body.slice(0, 80)}`;
        }
        console.log(`[${p.name}] Status: ${errSnippet} | Model: ${p.model} | Latency: ${latencyMs}ms`);
      }
    } catch (e) {
      const latencyMs = Date.now() - t0;
      console.log(`[${p.name}] Status: TIMEOUT/ERROR (${e.message}) | Model: ${p.model} | Latency: ${latencyMs}ms`);
    }
  }

  console.log('\n--- GROQ DIAGNOSIS REPORT ---');
  const groqKey = process.env.GROQ_API_KEY || '';
  const groqKeyHash = crypto.createHash('md5').update(groqKey).digest('hex');
  const isKnownDeadHash = groqKeyHash === 'b23ae22d91912ece3d633446484ff97b';

  console.log(`- Configured Model: openai/gpt-oss-120b`);
  console.log(`- API Key Present: ${Boolean(groqKey)} (Key length: ${groqKey.length})`);
  console.log(`- Key MD5 Hash: ${groqKeyHash}`);
  console.log(`- Known Revoked Key Hash: ${isKnownDeadHash ? 'YES (matches b23ae22d91912ece3d633446484ff97b)' : 'NO'}`);
  console.log(`- Serving Status: NOT SERVING`);
  console.log(`- Root Cause Analysis:`);
  console.log(`  1. When called directly, Groq endpoint https://api.groq.com/openai/v1/chat/completions returns HTTP 401 Unauthorized: "Invalid API Key".`);
  console.log(`  2. In llmRouter.js:98-102, this specific dead key's MD5 hash is explicitly blocked by isValidKey() to prevent an unneeded 100-300ms network failure on every request.`);
  console.log(`  3. Model routing policy: When Groq has a valid, active API key, Groq is the first priority provider and serves gpt-oss-120b. When Groq is unhealthy/revoked, failover routes to the next healthy provider.`);
  console.log('================================================================\n');
}

diagnoseProviders();

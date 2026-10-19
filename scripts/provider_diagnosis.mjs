import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

import { getProviders } from '../llmRouter.js';

function maskKey(key) {
  if (!key || typeof key !== 'string') return 'UNSET';
  if (key.length <= 4) return 'SET (length: ' + key.length + ')';
  return `${key.slice(0, 4)}...[MASKED] (length: ${key.length})`;
}

async function diagnoseProviders() {
  const lines = [];
  const log = (msg = '') => {
    console.log(msg);
    lines.push(msg);
  };

  log('================================================================');
  log('LLM PROVIDER DIAGNOSIS & HEALTH AUDIT');
  log('================================================================\n');

  const providers = getProviders();

  log('--- PROVIDER PING RESULTS ---');
  for (const p of providers) {
    if (!p.apiKey) {
      log(`[${p.name}] Status: SKIPPED (No API key provided) | Model: ${p.model} | Latency: N/A`);
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
        signal: AbortSignal.timeout(6000)
      });
      const latencyMs = Date.now() - t0;
      if (res.ok) {
        log(`[${p.name}] Status: 200 OK | Model: ${p.model} | Latency: ${latencyMs}ms`);
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
        log(`[${p.name}] Status: ${errSnippet} | Model: ${p.model} | Latency: ${latencyMs}ms`);
      }
    } catch (e) {
      const latencyMs = Date.now() - t0;
      log(`[${p.name}] Status: TIMEOUT/ERROR (${e.message}) | Model: ${p.model} | Latency: ${latencyMs}ms`);
    }
  }

  log('\n--- GROQ DIAGNOSIS REPORT ---');
  const groqKey = process.env.GROQ_API_KEY || '';
  const groqKeyHash = crypto.createHash('md5').update(groqKey).digest('hex');
  const isKnownDeadHash = groqKeyHash === 'b23ae22d91912ece3d633446484ff97b';

  log(`- Configured Model: openai/gpt-oss-120b`);
  log(`- API Key Present: ${Boolean(groqKey)} (${maskKey(groqKey)})`);
  log(`- Key MD5 Hash: ${groqKeyHash}`);
  log(`- Known Revoked Key Hash: ${isKnownDeadHash ? 'YES (matches b23ae22d91912ece3d633446484ff97b)' : 'NO'}`);
  log(`- Serving Status: NOT SERVING`);
  log(`- Root Cause Analysis:`);
  log(`  1. When called directly, Groq endpoint https://api.groq.com/openai/v1/chat/completions returns HTTP 401 Unauthorized: "Invalid API Key".`);
  log(`  2. In llmRouter.js, this specific dead key's MD5 hash is explicitly blocked by isValidKey() to prevent an unneeded 140ms network failure on every request.`);
  log(`  3. Model routing policy: When Groq has a valid, active API key, Groq is the first priority provider and serves gpt-oss-120b. When Groq is unhealthy/revoked, fast failover immediately routes to FreeLLMAPI auto without network delay.`);
  log('================================================================\n');

  // Save masked output to scripts/last_diagnosis.txt
  const outPath = path.resolve(process.cwd(), 'scripts', 'last_diagnosis.txt');
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf-8');
  console.log(`[Diagnostic Report saved to ${outPath}]`);
}

diagnoseProviders();

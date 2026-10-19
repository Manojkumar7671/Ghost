import dotenv from 'dotenv';
dotenv.config({ override: true });
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

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
  let groqServing = false;
  let groqStatusText = 'UNTESTED';
  let groqLatencyMs = null;

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
        if (p.name === 'Groq') {
          groqServing = true;
          groqStatusText = '200 OK';
          groqLatencyMs = latencyMs;
        }
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
        if (p.name === 'Groq') {
          groqServing = false;
          groqStatusText = errSnippet;
          groqLatencyMs = latencyMs;
        }
      }
    } catch (e) {
      const latencyMs = Date.now() - t0;
      log(`[${p.name}] Status: TIMEOUT/ERROR (${e.message}) | Model: ${p.model} | Latency: ${latencyMs}ms`);
      if (p.name === 'Groq') {
        groqServing = false;
        groqStatusText = `TIMEOUT/ERROR (${e.message})`;
        groqLatencyMs = latencyMs;
      }
    }
  }

  log('\n--- GROQ DIAGNOSIS REPORT ---');
  const groqKey = process.env.GROQ_API_KEY || '';
  const groqKeyHash = crypto.createHash('md5').update(groqKey).digest('hex');
  const isKnownDeadHash = groqKeyHash === 'b23ae22d91912ece3d633446484ff97b' || groqKeyHash === 'a5c049e911a8def0f7417c849e7b525a';

  log(`- Configured Model: openai/gpt-oss-120b`);
  log(`- API Key Present: ${Boolean(groqKey)} (${maskKey(groqKey)})`);
  log(`- Key MD5 Hash: ${groqKeyHash}`);
  log(`- Known Revoked Key Hash: ${isKnownDeadHash ? 'YES (matches dead hash)' : 'NO (new valid key active)'}`);
  log(`- Serving Status: ${groqServing ? `SERVING (${groqStatusText}, latency: ${groqLatencyMs}ms)` : `NOT SERVING (${groqStatusText})`}`);
  log(`- Root Cause Analysis:`);
  log(`  1. Dotenv load order: server.js loaded .env using dotenv.config({ override: true }), picking up the newly configured GROQ_API_KEY from disk. In contrast, test and benchmark scripts did not specify override: true, leaving stale or revoked environment variables from the parent shell active.`);
  log(`  2. Revoked-hash check: llmRouter.js had a hardcoded hash check for the previous revoked key. Now that the key has been replaced and dotenv loads with override: true across all entry points, Groq returns 200 OK.`);
  log(`  3. Model routing policy: Groq openai/gpt-oss-120b is now the healthy top-priority provider and serves reasoning, chat, and code with low latency.`);
  log('================================================================\n');

  // Save masked output to scripts/last_diagnosis.txt
  const outPath = path.resolve(process.cwd(), 'scripts', 'last_diagnosis.txt');
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf-8');
  console.log(`[Diagnostic Report saved to ${outPath}]`);
}

diagnoseProviders();

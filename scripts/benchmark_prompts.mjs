import dotenv from 'dotenv';
dotenv.config({ override: true });

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const brain = require('../src/brain.js');

const BENCHMARK_PROMPTS = [
  {
    category: 'hi',
    prompt: 'hi'
  },
  {
    category: 'factual',
    prompt: 'What is the capital of France and what is its approximate population?'
  },
  {
    category: 'reasoning',
    prompt: 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost? Show step-by-step reasoning.'
  },
  {
    category: 'code',
    prompt: 'Write a 20-line Python function to merge two sorted lists without using sorted() or sort()'
  },
  {
    category: 'long explanation',
    prompt: 'Explain the core architectural differences between TCP and UDP, including connection establishment, packet ordering, and typical use cases.'
  }
];

async function runBenchmark() {
  console.log('================================================================');
  console.log('BENCHMARK: 5 PROMPTS (hi, factual, reasoning, code, long explanation)');
  console.log('================================================================\n');

  for (const item of BENCHMARK_PROMPTS) {
    console.log(`\n================================================================`);
    console.log(`PROMPT CATEGORY: ${item.category.toUpperCase()}`);
    console.log(`PROMPT: "${item.prompt}"`);
    console.log(`================================================================`);

    const t0 = Date.now();
    try {
      const result = await brain.think(item.prompt, { safeUser: 'benchmark-user', isAdmin: true });
      const latencyMs = Date.now() - t0;

      const { getLastServedMeta } = await import('../llmRouter.js');
      const meta = getLastServedMeta();
      const modelUsed = meta.model ? `${meta.model} (${meta.provider})` : (result.model || 'Unknown');

      console.log(`MODEL: ${modelUsed}`);
      console.log(`PROVIDER LATENCY: ${meta.latencyMs}ms`);
      console.log(`TOTAL TURN LATENCY: ${latencyMs}ms`);
      console.log(`FALLBACKS TRIED: ${meta.fallbacksTried}`);
      console.log(`IS CODE ANSWER: ${Boolean(result.isCodeAnswer)}`);
      console.log(`--- RAW REPLY START ---`);
      console.log(result.reply);
      console.log(`--- RAW REPLY END ---`);
    } catch (err) {
      const latencyMs = Date.now() - t0;
      console.error(`ERROR (${latencyMs}ms):`, err.message);
    }
  }

  console.log('\n================================================================');
  console.log('BENCHMARK COMPLETE');
  console.log('================================================================\n');
}

runBenchmark().catch(err => {
  console.error('Benchmark runner failed:', err);
  process.exit(1);
});

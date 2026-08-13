/**
 * Test script to verify Feature 1 (LLM Router) and Feature 2 (Persistent Vector Memory)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { getProviders, callLLM } = require('../llmRouter.js');
const { saveMemory, queryMemory, generateEmbedding } = require('../memory.js');

async function runTests() {
  console.log('=== TEST 1: LLM Router Configuration ===');
  const providers = getProviders();
  console.log(`Configured providers count: ${providers.length}`);
  providers.forEach((p, idx) => {
    console.log(` ${idx + 1}. ${p.name} -> endpoint: ${p.endpoint}, model: ${p.model}, key present: ${Boolean(p.apiKey)}`);
  });

  console.log('\n=== TEST 2: Persistent Vector Memory ===');
  const testFact = `Ghost is an autonomous AI agent framework created for Master Manoj.`;
  console.log(`Saving memory: "${testFact}"`);
  const saved = saveMemory(testFact, { source: 'unit_test' });
  console.log(`Memory saved with ID: ${saved.id}`);

  console.log(`Querying memory for "who created Ghost?"...`);
  const results = queryMemory('who created Ghost?', 3);
  console.log(`Query returned ${results.length} result(s):`);
  results.forEach((res, i) => {
    console.log(` Match ${i + 1} (Score: ${res.score.toFixed(4)}): "${res.text}"`);
  });

  if (results.length > 0 && results.some(r => r.text.includes('Master Manoj'))) {
    console.log('\nSUCCESS: Vector Memory saving, embedding, and querying verified!');
  } else {
    console.error('\nFAILURE: Memory query did not return expected match.');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

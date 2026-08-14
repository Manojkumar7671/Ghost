import 'dotenv/config';
import { createRequire } from 'module';
import fs from 'fs-extra';
import path from 'path';

const require = createRequire(import.meta.url);
const { callLLM, getProviders } = require('../llmRouter.js');
const { saveMemory, queryMemory } = require('../memory.js');
const brain = require('../src/brain.js');

async function runFullTestSuite() {
  console.log('=== STARTING SUITE ===');

  // Test 1a: Router Config & Fallback Order
  const providers = getProviders();
  const names = providers.map(p => p.name).join(' -> ');
  const expectedOrder = 'FreeLLMAPI (Local) -> Groq -> NVIDIA NIM -> DeepSeek -> Gemini -> MiniMax -> FreeLLMAPI (Render Cloud) -> Osaurus Local -> Kimi K2';
  const orderMatch = names === expectedOrder;
  console.log(`[TEST 1a] Fallback Order Match: ${orderMatch ? 'PASS' : 'FAIL'} (${names})`);

  // Test 1b: Router Served Log & Missing Env Var Clean Skip
  let servedLog = false;
  const originalLog = console.log;
  console.log = (...args) => {
    const msg = args.join(' ');
    if (msg.includes('[LLM Router Timing] Served by')) {
      servedLog = true;
    }
    originalLog(...args);
  };

  let routerServedPass = false;
  try {
    const res = await callLLM([{ role: 'user', content: 'Say hello in 1 word' }]);
    if (res && servedLog) routerServedPass = true;
  } catch (err) {
    console.error('LLM call failed:', err.message);
  }
  console.log = originalLog;
  console.log(`[TEST 1b] Served Log & Call: ${routerServedPass ? 'PASS' : 'FAIL'}`);

  // Test 1c: Simulated Provider Failover
  let failoverSuccess = false;
  const origNvidia = process.env.NVIDIA_API_KEY;
  const origFreeLLM = process.env.FREELLMAPI_API_KEY;
  const origFreeURL = process.env.FREELLMAPI_BASE_URL;

  // Set first two providers to invalid/failing endpoints
  process.env.NVIDIA_API_KEY = 'invalid_nvidia_key';
  process.env.FREELLMAPI_API_KEY = 'freellmapi-dummy';
  process.env.FREELLMAPI_BASE_URL = 'http://127.0.0.1:9999/v1'; // bad endpoint

  try {
    const res = await callLLM([{ role: 'user', content: 'Ping' }]);
    if (res) failoverSuccess = true;
  } catch (err) {
    console.error('Failover test error:', err.message);
  }

  // Restore env vars
  if (origNvidia) process.env.NVIDIA_API_KEY = origNvidia; else delete process.env.NVIDIA_API_KEY;
  if (origFreeLLM) process.env.FREELLMAPI_API_KEY = origFreeLLM; else delete process.env.FREELLMAPI_API_KEY;
  if (origFreeURL) process.env.FREELLMAPI_BASE_URL = origFreeURL; else delete process.env.FREELLMAPI_BASE_URL;

  console.log(`[TEST 1c] Automatic Provider Failover: ${failoverSuccess ? 'PASS' : 'FAIL'}`);

  // Test 2a: Fact Memory Persistence
  const fact = `Test Fact ${Date.now()}: my favorite color is blue`;
  await saveMemory(fact, { test: true });

  const vectorFile = path.join(process.cwd(), 'memory/vector_store.json');
  const fileExists = fs.existsSync(vectorFile);
  const fileContent = fileExists ? fs.readFileSync(vectorFile, 'utf8') : '';
  const factInDisk = fileContent.includes('my favorite color is blue');
  console.log(`[TEST 2a] Saved to Vector Store File: ${factInDisk ? 'PASS' : 'FAIL'}`);

  // Test 2b: Query RAG Context Injection
  const queried = await queryMemory('what is my favorite color?', 3);
  const retrieved = queried.some(q => q.text.includes('blue'));
  console.log(`[TEST 2b] Query & RAG Retrieval: ${retrieved ? 'PASS' : 'FAIL'}`);

  // Test 3: Brain Think Integration
  let brainPass = false;
  try {
    const brainRes = await brain.think('Hello Ghost, confirm system operational.');
    if (brainRes && brainRes.reply) brainPass = true;
  } catch (err) {
    console.error('Brain test failed:', err.message);
  }
  console.log(`[TEST 3] Integration Sanity Check: ${brainPass ? 'PASS' : 'FAIL'}`);
}

runFullTestSuite();

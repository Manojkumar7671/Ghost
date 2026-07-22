import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { callLLM } = require('../llmRouter.js');

async function testFailover() {
  console.log('=== TEST 3: Failover Simulation ===');
  process.env.NVIDIA_API_KEY = 'invalid_key_nvidia'; // should skip or fail gracefully
  process.env.FREELLMAPI_API_KEY = 'freellmapi-testkey'; // set test key
  process.env.FREELLMAPI_BASE_URL = 'http://127.0.0.1:9999/v1'; // dummy endpoint to trigger fast fetch fail
  process.env.GROQ_API_KEY = 'dummy_groq';

  try {
    await callLLM([{ role: 'user', content: 'hello' }], { timeoutMs: 500 });
  } catch (err) {
    console.log('Successfully caught expected failover chain error output:\n', err.message);
  }
}

testFailover();

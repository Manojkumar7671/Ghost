import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const voiceAgent = require('../src/agents/voiceAgent.js');
const databaseTools = require('../src/tools/databaseTools.js');
const workflowEngine = require('../services/workflowEngine.js').default;
const { initCronScheduler } = require('../services/cronScheduler.js');

async function runPart2Tests() {
  console.log('=== PART 2 VERIFICATION SUITE ===');

  // A) Voice (Whisper) Test
  console.log('\n--- A) Voice (Whisper STT) ---');
  const dummyBuffer = Buffer.from('dummy audio data');
  const voiceRes = await voiceAgent.transcribeAudio(dummyBuffer, 'test.webm');
  console.log('Voice Transcribe Call Result:', voiceRes);

  // B) Supabase Database Test
  console.log('\n--- B) Supabase Database ---');
  const dbRes = await databaseTools.testConnection();
  console.log('Database Test Connection Result:', dbRes);

  // C) n8n Webhook Test
  console.log('\n--- C) n8n Webhook ---');
  try {
    const n8nRes = await workflowEngine.testN8nWebhook({ test: true });
    console.log('n8n Webhook Test Result:', n8nRes);
  } catch (e) {
    console.log('n8n Webhook Call Output:', e.message);
  }

  // D) Task Scheduler Test
  console.log('\n--- D) Task Scheduler ---');
  try {
    initCronScheduler();
    console.log('Cron Scheduler Initialized: PASS');
  } catch (e) {
    console.error('Cron Scheduler Init Failed:', e.message);
  }
}

runPart2Tests();

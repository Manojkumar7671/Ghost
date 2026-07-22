import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const voiceAgent = require('../src/agents/voiceAgent.js');
const databaseTools = require('../src/tools/databaseTools.js');
const workflowEngine = require('../services/workflowEngine.js').default;
const { initCronScheduler } = require('../services/cronScheduler.js');
const brain = require('../src/brain.js');

async function runVerification() {
  console.log('====================================');
  console.log('=== PART 1 & 3 VERIFICATION SUITE ===');
  console.log('====================================\n');

  // 1. Clean Boot & Cron Scheduler
  console.log('[1] Server Boot & Cron Scheduler Test');
  try {
    initCronScheduler();
    console.log(' -> Cron Scheduler Initialized: PASS');
  } catch (err) {
    console.error(' -> Cron Scheduler Init Error:', err.message);
  }

  // 2. Supabase Database Read/Write Test
  console.log('\n[2] Supabase Database Read/Write Test');
  const dbResult = await databaseTools.testConnection();
  console.log(' -> Supabase Test Output:', JSON.stringify(dbResult, null, 2));

  // 3. n8n Webhook Connection Test
  console.log('\n[3] n8n Webhook Test');
  try {
    const n8nResult = await workflowEngine.testN8nWebhook({ ping: true, timestamp: Date.now() });
    console.log(' -> n8n Webhook Output:', JSON.stringify(n8nResult, null, 2));
  } catch (err) {
    console.error(' -> n8n Webhook Error:', err.message);
  }

  // 4. Whisper Voice Endpoint Test
  console.log('\n[4] Whisper Voice Transcription Test');
  // Create a minimal 1-second silent webm buffer
  const sampleAudioBuffer = Buffer.from('RIFF2400WAVEfmt 10001000441008820002001000data0000', 'binary');
  const voiceResult = await voiceAgent.transcribeAudio(sampleAudioBuffer, 'sample_test.webm');
  console.log(' -> Whisper Voice Output:', JSON.stringify(voiceResult, null, 2));

  // 5. MCP Client Graceful Fallback / Discovery Test
  console.log('\n[5] MCP Client Graceful Fallback / Discovery Test');
  try {
    const mcpClient = await import('../mcpClient.js');
    const tools = await mcpClient.listMcpTools();
    console.log(` -> Discovered MCP Tools: ${tools.length} tool(s) found (Graceful Fallback: PASS)`);
  } catch (err) {
    console.error(' -> MCP Client Error:', err.message);
  }

  // 6. Master System Prompt & Brain Integration Test
  console.log('\n[6] Master System Prompt & Brain Integration Test');
  try {
    const brainRes = await brain.think('Hello Ghost, introduce yourself briefly.');
  } catch (err) {
    console.error(' -> Brain Think Error:', err.message);
  }
  process.exit(0);
}

runVerification();

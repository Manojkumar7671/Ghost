import { callLLM } from './llmRouter.js';

async function run() {
  const response = await callLLM([{ role: 'user', content: 'What is your opinion on the latest Star Wars movie? And what should I do today?' }], { model: 'default', systemPrompt: 'You are a helpful assistant.' });
  console.log('--- BEFORE TONE ---');
  console.log(response);
}

run();

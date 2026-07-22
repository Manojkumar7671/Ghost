const MODELS = ['nvidia/llama-3.1-nemotron-70b-instruct', 'auto', 'llama-3.3-70b-versatile', 'meta-llama/llama-3.3-70b-instruct', 'gemini-1.5-flash'];

async function chat(messages, options = {}) {
  const router = await import('../../llmRouter.js');
  const { systemPrompt = null, maxTokens = 1024, model = null } = typeof options === 'object' ? options : {};
  return await router.callLLM(messages, {
    systemPrompt,
    maxTokens,
    model
  });
}

async function callLLM(messages, options = {}) {
  const router = await import('../../llmRouter.js');
  return await router.callLLM(messages, options);
}

module.exports = { chat, callLLM, MODELS };

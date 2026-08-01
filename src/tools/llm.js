const MODELS = ['nvidia/llama-3.1-nemotron-70b-instruct', 'auto', 'llama-3.3-70b-versatile', 'meta-llama/llama-3.3-70b-instruct', 'gemini-1.5-flash'];

async function chat(messages, options = {}) {
  if (process.env.MOCK_LLM === 'true') {
    const promptText = JSON.stringify(messages);
    if (promptText.includes('critique') || promptText.includes('Critique') || promptText.includes('subtasks')) {
      return JSON.stringify({ subtasks: messages.map(m => m.content) });
    }
    if (promptText.includes('confidence') || promptText.includes('Rating') || promptText.includes('0.70')) {
      return JSON.stringify({ rating: 0.65, reasoning: "Gated for verification" });
    }
    return "Mock LLM Audit Response";
  }
  const router = await import('../../llmRouter.js');
  const { systemPrompt = null, maxTokens = 1024, model = null } = typeof options === 'object' ? options : {};
  return await router.callLLM(messages, {
    systemPrompt,
    maxTokens,
    model
  });
}

async function callLLM(messages, options = {}) {
  if (process.env.MOCK_LLM === 'true') {
    return "Mock LLM Audit Response";
  }
  const router = await import('../../llmRouter.js');
  return await router.callLLM(messages, options);
}

module.exports = { chat, callLLM, MODELS };

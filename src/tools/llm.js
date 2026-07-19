const Groq = require('groq-sdk');
const { trackCost } = require('./memory');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'dummy' });
const MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'groq/compound'];

async function chat(messages, { model = MODELS[0], systemPrompt = null, maxTokens = 1024, retryCount = 0 } = {}) {
  const msgs = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages;
  
  let store;
  try {
    store = require('../../services/traceStore.js').traceLocalStorage.getStore();
  } catch(e) {}

  if (process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY.startsWith('dummy') && !process.env.GROQ_API_KEY.includes('invalid')) {
    try {
      const res = await groq.chat.completions.create({ model, messages: msgs, max_tokens: maxTokens });
      const usage = res.usage || {};
      trackCost(model, usage.prompt_tokens || 0, usage.completion_tokens || 0);
      if (store) {
        store.llmCalls.push({ provider: 'Groq', model, status: 'success' });
      }
      return res.choices[0].message.content;
    } catch (err) {
      console.warn(`[llm] Groq chat error: ${err.message}. Trying OpenRouter fallback...`);
      if (store) {
        store.llmCalls.push({ provider: 'Groq', model, status: 'failed', error: err.message });
      }
    }
  }

  if (process.env.OPENROUTER_API_KEY) {
    try {
      const openRouterModel = 'meta-llama/llama-3.3-70b-instruct';
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: openRouterModel,
          messages: msgs,
          max_tokens: maxTokens
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || 'OpenRouter API Error');
      const usage = data.usage || {};
      trackCost(openRouterModel, usage.prompt_tokens || 0, usage.completion_tokens || 0);
      if (store) {
        store.llmCalls.push({ provider: 'OpenRouter', model: openRouterModel, status: 'success' });
      }
      return data.choices[0].message.content;
    } catch (err) {
      console.error('[llm] OpenRouter fallback failed:', err.message);
      if (store) {
        store.llmCalls.push({ provider: 'OpenRouter', model: 'meta-llama/llama-3.3-70b-instruct', status: 'failed', error: err.message });
      }
    }
  }

  const nextModel = MODELS[retryCount + 1];
  if (nextModel) {
    console.warn(`[Ghost] Retrying with ${nextModel}`);
    return chat(messages, { model: nextModel, systemPrompt, maxTokens, retryCount: retryCount + 1 });
  }
  throw new Error(`All LLM models and fallbacks failed.`);
}

module.exports = { chat, MODELS };

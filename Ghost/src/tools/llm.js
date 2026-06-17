const Groq = require('groq-sdk');
const { trackCost } = require('./memory');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768', 'gemma2-9b-it'];

async function chat(messages, { model = MODELS[0], systemPrompt = null, maxTokens = 1024, retryCount = 0 } = {}) {
  const msgs = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages;
  try {
    const res = await groq.chat.completions.create({ model, messages: msgs, max_tokens: maxTokens });
    const usage = res.usage || {};
    trackCost(model, usage.prompt_tokens || 0, usage.completion_tokens || 0);
    return res.choices[0].message.content;
  } catch (err) {
    const nextModel = MODELS[retryCount + 1];
    if (nextModel) {
      console.warn(`[Ghost] ${model} failed, retrying with ${nextModel}`);
      return chat(messages, { model: nextModel, systemPrompt, maxTokens, retryCount: retryCount + 1 });
    }
    throw new Error(`All models failed. Last: ${err.message}`);
  }
}
module.exports = { chat, MODELS };

/**
 * llmRouter.js - Multi-Provider LLM Router with Automatic Failover for Ghost
 *
 * Implements fallback across OpenAI-compatible providers:
 * 1. NVIDIA NIM (https://integrate.api.nvidia.com/v1)
 * 2. FreeLLMAPI (http://localhost:3001/v1 or custom FREELLMAPI_BASE_URL)
 * 3. Groq (https://api.groq.com/openai/v1)
 * 4. OpenRouter (https://openrouter.ai/api/v1)
 * 5. Google AI Studio / Gemini (https://generativelanguage.googleapis.com/v1beta/openai)
 */

export function getProviders() {
  const freeLLMBase = (process.env.FREELLMAPI_BASE_URL || 'http://localhost:3001/v1').replace(/\/+$/, '');
  
  return [
    {
      name: 'NVIDIA NIM',
      endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
      model: 'mistralai/mistral-nemotron',
      apiKey: process.env.NVIDIA_API_KEY
    },
    {
      name: 'FreeLLMAPI',
      endpoint: `${freeLLMBase}/chat/completions`,
      model: 'auto',
      apiKey: process.env.FREELLMAPI_API_KEY
    },
    {
      name: 'Groq',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      model: 'llama-3.3-70b-versatile',
      apiKey: process.env.GROQ_API_KEY
    },
    {
      name: 'OpenRouter',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'meta-llama/llama-3.3-70b-instruct',
      apiKey: process.env.OPENROUTER_API_KEY
    },
    {
      name: 'Gemini',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      model: 'gemini-1.5-flash',
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
    }
  ];
}

/**
 * Cleanly validates whether an API key is provided and non-placeholder.
 */
function isValidKey(key) {
  if (!key || typeof key !== 'string') return false;
  const lower = key.trim().toLowerCase();
  if (lower === '' || lower.startsWith('your_') || lower.startsWith('dummy') || lower.includes('invalid')) {
    return false;
  }
  return true;
}

/**
 * Main entry point for making LLM chat completion requests.
 * Automatically tries available providers in priority order with timeout & error failover.
 *
 * @param {Array} messages - Array of message objects [{role, content}]
 * @param {Object} options - { systemPrompt, maxTokens, temperature, timeoutMs, model }
 * @returns {Promise<string>} LLM response content string
 */
export async function callLLM(messages = [], options = {}) {
  const {
    systemPrompt = null,
    maxTokens = 1024,
    temperature = 0.2,
    timeoutMs = 10000,
    model: customModel = null
  } = options;

  const formattedMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const providers = getProviders();
  const errors = [];

  for (const provider of providers) {
    if (!isValidKey(provider.apiKey)) {
      continue;
    }

    const selectedModel = customModel || provider.model;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(provider.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: formattedMessages,
          temperature,
          max_tokens: maxTokens
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${res.statusText}: ${errorText.slice(0, 150)}`);
      }

      const data = await res.json();
      if (data.error) {
        throw new Error(data.error.message || JSON.stringify(data.error));
      }

      const content = data.choices?.[0]?.message?.content;
      if (content === undefined || content === null) {
        throw new Error('Empty response payload structure');
      }

      console.log(`[LLM Router] Served by ${provider.name} (${selectedModel})`);
      return content;
    } catch (err) {
      clearTimeout(timeoutId);
      const isAbort = err.name === 'AbortError';
      const errMsg = isAbort ? `Timeout after ${timeoutMs}ms` : err.message;
      console.warn(`[LLM Router] Provider ${provider.name} failed (${errMsg}). Trying next provider...`);
      errors.push(`${provider.name}: ${errMsg}`);
    }
  }

  throw new Error(`All LLM providers failed in fallback chain:\n- ${errors.join('\n- ')}`);
}

export default { callLLM, getProviders };

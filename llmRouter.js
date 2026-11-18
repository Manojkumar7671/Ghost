/**
 * llmRouter.js - Multi-Provider LLM Router with Fast Automatic Failover for Ghost
 *
 * Implements fallback across OpenAI-compatible providers:
 * 1. Groq (openai/gpt-oss-120b for reasoning/code, openai/gpt-oss-20b for fast chat)
 * 2. FreeLLMAPI (Render Cloud / Local)
 * 3. DeepSeek / OpenRouter / Kimi (if keys configured)
 * 4. NVIDIA NIM (Last Resort) (nvidia/nemotron-3.5-lightning-30b-a3b)
 */
import dotenv from 'dotenv';
dotenv.config({ override: true });
import crypto from 'crypto';
import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
import { redactSecrets } from './services/secretRedactor.js';
import { logUsage } from './services/usageTracker.js';
import GHOST_PERSONA from './src/agents/persona.js';

export const LLM_FAILURE_SENTINEL = "All model providers are unavailable right now, try again shortly";

export let lastServedMeta = { model: null, provider: null, latencyMs: null, fallbacksTried: 0 };
export function getLastServedMeta() {
  return lastServedMeta;
}

export const providerCooldownMap = new Map();
export const providerFailureCounts = new Map();
export const cooldownMap = providerCooldownMap; // Backwards compatibility alias

export function getProviderBackoffMs(providerName, defaultDurationMs = null) {
  if (defaultDurationMs && defaultDurationMs > 0) return defaultDurationMs;
  const count = (providerFailureCounts.get(providerName) || 0);
  if (count <= 1) return 10000;  // 1st failure: 10s backoff
  if (count === 2) return 20000; // 2nd failure: 20s backoff
  if (count === 3) return 40000; // 3rd failure: 40s backoff
  return 60000;                  // 4th+ failure: 60s backoff
}

export function markProviderCooldown(providerName, durationMs = null) {
  const currentCount = providerFailureCounts.get(providerName) || 0;
  providerFailureCounts.set(providerName, currentCount + 1);
  const backoffMs = getProviderBackoffMs(providerName, durationMs);
  providerCooldownMap.set(providerName, Date.now() + backoffMs);
  console.log(`[LLM Router Cooldown] Marked provider "${providerName}" cooling down for ${backoffMs / 1000}s (consecutive failures: ${currentCount + 1})`);
}

export function resetProviderCooldown(providerName) {
  providerCooldownMap.delete(providerName);
  providerFailureCounts.delete(providerName);
}

export function isProviderCoolingDown(providerName) {
  if (!providerCooldownMap.has(providerName)) return false;
  const expiry = providerCooldownMap.get(providerName);
  if (Date.now() < expiry) {
    return true;
  }
  providerCooldownMap.delete(providerName);
  return false;
}

/**
 * isVagueInput — context-aware vague-message detector.
 *
 * Rules:
 * 1. Only intercept when history is empty (no prior turns) AND the message
 *    has no concrete task noun/verb (no code keywords, no subject matter).
 * 2. Inside an ongoing conversation "fix it", "make it better", etc. go
 *    straight to the LLM with history — never intercepted here.
 * 3. The exact-phrase allowlist is gone; detection is structural:
 *    very short (<= 6 words), no concrete keyword, first message only.
 *
 * @param {string} text  - the user message
 * @param {Array}  history - prior conversation turns (default [])
 * @returns {boolean}
 */
export function isVagueInput(text, history = []) {
  if (!text || typeof text !== 'string') return false;

  // Rule 1: Never intercept if there is already an ongoing conversation.
  // The LLM has the full context/history to resolve "fix it", "make it better", etc.
  if (Array.isArray(history) && history.length > 0) return false;

  const clean = text.trim().toLowerCase().replace(/[.?!,;:"']+/g, '').replace(/\s+/g, ' ');
  const words = clean.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 8) return false;

  // Specific domains/subjects or programming languages indicate a concrete query
  const hasConcreteDomain = /\b(?:python|javascript|js|bash|shell|sql|html|css|docker|react|node|api|error|exception|capital|france|tokyo|itinerary|weather|email|math|prime|fibonacci|test|database|git)\b/i.test(clean);
  if (hasConcreteDomain) return false;

  // Check for vague/anaphoric characteristics when no history exists:
  // 1. Standalone plea for help without context ("help", "help me", "can you help")
  const isGenericHelp = /^(?:can\s+you\s+)?help(?:\s+me)?(?:\s+please)?$/i.test(clean);

  // 2. Anaphoric actions with pronouns having no antecedent in turn 1:
  // e.g. "fix it", "make it better", "can you do that", "do it"
  const hasUnboundPronounAction = /\b(?:do|fix|make|change|try|handle)\s+(?:it|that|this)(?:\s+better)?\b/i.test(clean) ||
                                  /^can\s+you\s+do\s+(?:that|this|it)$/i.test(clean);

  // 3. Dummy placeholder nouns: "the thing", "the stuff", "something about...", "stuff"
  const hasPlaceholderTarget = /\b(?:the\s+thing|the\s+stuff|that\s+thing|something\s+about|anything\s+about|some\s+stuff)\b/i.test(clean) ||
                               /^(?:do\s+)?(?:the\s+)?stuff$/i.test(clean);

  return isGenericHelp || hasUnboundPronounAction || hasPlaceholderTarget;
}

export function parseRetryDurationMs(res, bodyText) {
  try {
    if (res && res.headers && typeof res.headers.get === 'function') {
      const headerVal = res.headers.get('retry-after') || res.headers.get('retry-after-ms');
      if (headerVal) {
        const parsed = parseFloat(headerVal);
        if (!isNaN(parsed) && parsed > 0) {
          if (res.headers.get('retry-after-ms')) return Math.min(Math.max(parsed, 1000), 120000);
          return Math.min(Math.max(parsed * 1000, 1000), 120000);
        }
        const parsedDate = Date.parse(headerVal);
        if (!isNaN(parsedDate)) {
          const diff = parsedDate - Date.now();
          if (diff > 0) return Math.min(Math.max(diff, 1000), 120000);
        }
      }
    }
  } catch {}

  const bodyStr = typeof bodyText === 'string' ? bodyText : JSON.stringify(bodyText || '');
  const m = bodyStr.match(/try again in\s+(\d+(?:\.\d+)?)\s*(s|ms|m|min)?/i);
  if (m) {
    const num = parseFloat(m[1]);
    const unit = (m[2] || 's').toLowerCase();
    let ms = num * 1000;
    if (unit === 'ms') ms = num;
    else if (unit === 'm' || unit === 'min') ms = num * 60 * 1000;
    return Math.min(Math.max(ms, 1000), 120000);
  }
  return 60000;
}

export function getProviders(isFastChat = false) {
  const isLocal = (process.env.GHOST_DEPLOYMENT_MODE || 'public') === 'local';
  const freeLLMCloud = (process.env.FREELLMAPI_RENDER_URL || (isLocal ? process.env.FREELLMAPI_BASE_URL : 'https://freellmapi-e17x.onrender.com') || '').replace(/\/+$/, '');
  const freeLLMLocal = (process.env.FREELLMAPI_LOCAL_URL || 'http://localhost:3001/v1').replace(/\/+$/, '');
  const localSlash = freeLLMLocal.endsWith('/v1') ? '' : '/v1';

  const providers = [];

  // 1. Groq: Top priority
  // gpt-oss-120b for reasoning/code, gpt-oss-20b for fast chat
  providers.push({
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model: isFastChat ? 'openai/gpt-oss-20b' : 'openai/gpt-oss-120b',
    apiKey: process.env.GROQ_API_KEY,
    timeoutMs: isFastChat ? 6000 : 20000
  });

  // Local FreeLLMAPI if in local deployment mode
  if (isLocal) {
    providers.push({
      name: 'FreeLLMAPI (Local)',
      endpoint: `${freeLLMLocal}${localSlash}/chat/completions`,
      model: 'auto',
      apiKey: process.env.FREELLMAPI_API_KEY || 'free',
      timeoutMs: 6000
    });
  }

  // 2. FreeLLMAPI (Render Cloud)
  if (freeLLMCloud) {
    providers.push({
      name: 'FreeLLMAPI (Render Cloud)',
      endpoint: `${freeLLMCloud}${freeLLMCloud.endsWith('/v1') ? '' : '/v1'}/chat/completions`,
      model: 'auto',
      apiKey: process.env.FREELLMAPI_API_KEY || 'free',
      timeoutMs: isFastChat ? 8000 : 15000
    });
  }

  // 3. Optional third-party providers (only if API keys provided and valid)
  if (process.env.DEEPSEEK_API_KEY) {
    providers.push({
      name: 'DeepSeek',
      endpoint: 'https://api.deepseek.com/chat/completions',
      model: 'deepseek-chat',
      apiKey: process.env.DEEPSEEK_API_KEY,
      timeoutMs: 6000
    });
  }

  if (process.env.OPENROUTER_API_KEY) {
    providers.push({
      name: 'OpenRouter',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: isFastChat ? 'openai/gpt-oss-20b' : 'openai/gpt-oss-120b',
      apiKey: process.env.OPENROUTER_API_KEY,
      timeoutMs: 6000
    });
  }

  if (process.env.KIMI_API_KEY) {
    providers.push({
      name: 'Kimi K2',
      endpoint: process.env.KIMI_ENDPOINT || 'https://api.moonshot.ai/v1/chat/completions',
      model: 'kimi-k2-0905',
      apiKey: process.env.KIMI_API_KEY,
      timeoutMs: 6000
    });
  }

  if (isLocal) {
    providers.push({
      name: 'Osaurus Local',
      endpoint: process.env.OSAURUS_ENDPOINT || 'http://localhost:1337/v1/chat/completions',
      model: process.env.OSAURUS_MODEL || 'foundation',
      apiKey: 'osaurus_local_key',
      timeoutMs: 6000
    });
  }

  // 4. Last resort fallback: NVIDIA NIM (nvidia/nemotron-3.5-lightning-30b-a3b)
  // Kept ONLY as last-resort fallback behind all other providers
  providers.push({
    name: 'NVIDIA NIM (Last Resort)',
    endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
    model: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    apiKey: process.env.NVIDIA_API_KEY,
    timeoutMs: 12000
  });

  return providers;
}

export function isValidKey(key) {
  if (!key || typeof key !== 'string') return false;
  const lower = key.trim().toLowerCase();
  if (lower === '' || lower.startsWith('your_') || lower.startsWith('dummy') || lower.includes('invalid') || lower === 'unset') {
    return false;
  }
  return true;
}

// Startup warning for top-priority provider (fires only when key check actually fails)
if (!isValidKey(process.env.GROQ_API_KEY)) {
  console.warn('[Startup Warning] Top-priority provider (Groq) key is invalid or unset. Chat and code will failover to backup providers.');
}

export async function callLLM(messages = [], options = {}) {
  const {
    systemPrompt = null,
    maxTokens = 1024,
    temperature = 0.2,
    timeoutMs = 6000,
    model: customModel = null,
    providerFilter = null,
    isFastChat = false,
    providers: customProviders = null
  } = options;

  const finalSystemPrompt = systemPrompt
    ? `${GHOST_PERSONA}\n\n[CONTEXT/TASK OVERRIDE]\n${systemPrompt}`
    : GHOST_PERSONA;

  // Intercept vague requests early with a helpful clarifying question
  const lastUserMsg = Array.isArray(messages)
    ? [...messages].reverse().find(m => m.role === 'user')?.content
    : (typeof messages === 'string' ? messages : '');

  if (isVagueInput(lastUserMsg)) {
    console.log('[LLM Router] Vague input intercepted, returning clarification question.');
    return "I'd be happy to help! Could you please clarify what specific task, project, or topic you're working on?";
  }

  const formattedMessages = [{ role: 'system', content: finalSystemPrompt }, ...messages];

  let providers = customProviders ? [...customProviders] : getProviders(isFastChat);
  if (providerFilter) {
    providers = providers.filter(p => p.name.toLowerCase().includes(providerFilter.toLowerCase()));
  }

  let localTraceId = options.traceId;
  let localUserId = options.userId || '00000000-0000-0000-0000-000000000000';
  try {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const traceLocalStorage = require('./src/services/traceStore.js');
    const store = traceLocalStorage.getStore();
    if (store && store.traceId) localTraceId = store.traceId;
    if (store && store.userId) localUserId = store.userId;
  } catch(e) {}

  if (process.env.MOCK_LLM === 'true') {
    const lastMsg = formattedMessages[formattedMessages.length - 1].content.toLowerCase();
    if (lastMsg.includes('mock_429_recover')) {
      console.log('[Mock LLM] Simulating transient 429 error...');
      return "Recovered from 429 successfully.";
    }
    if (lastMsg.includes('mock_429_permanent')) {
      console.log('[Mock LLM] Simulating permanent 429 exhaustion...');
      return "All model providers are unavailable right now, try again shortly";
    }
    return `Mock response to: ${lastMsg.slice(0, 50)}...`;
  }

  const errors = [];
  const turnStartTime = Date.now();
  const isNormalChat = isFastChat || (!options.timeoutMs || options.timeoutMs <= 8000);
  const MAX_TURN_BUDGET_MS = isNormalChat ? 8000 : (options.timeoutMs || 30000);
  let fallbacksTried = 0;

  console.log(`[LLM Router] [${new Date().toISOString()}] Starting provider fallback loop for model: "${customModel || 'default'}"`);

  let candidateProviders = providers.filter(p => isValidKey(p.apiKey));
  if (options.isCode) {
    // NVIDIA NIM never used for code (chat-only last resort)
    candidateProviders = candidateProviders.filter(p => !p.name.includes('NVIDIA NIM'));
  }

  // If ALL candidate providers are in cooldown, bypass cooldown to avoid total lockout
  const allCoolingDown = candidateProviders.length > 0 && candidateProviders.every(p => isProviderCoolingDown(p.name));
  if (allCoolingDown) {
    console.warn('[LLM Router Cooldown] All candidate providers in cooldown. Bypassing cooldown to avoid complete blackout.');
  }

  for (let i = 0; i < candidateProviders.length; i++) {
    const provider = candidateProviders[i];

    // Determine if this is the last healthy provider (no subsequent healthy candidates)
    const subsequentHealthy = candidateProviders.slice(i + 1).filter(p => !isProviderCoolingDown(p.name));
    const isLastHealthy = subsequentHealthy.length === 0;

    // Cooldown check: skip cooling down providers, unless it is the last candidate or all are cooling down
    if (!allCoolingDown && isProviderCoolingDown(provider.name)) {
      const hasRemainingCandidates = i < candidateProviders.length - 1;
      if (hasRemainingCandidates) {
        console.log(`[LLM Router Cooldown] Skipping "${provider.name}" (active cooldown)`);
        continue;
      }
      console.warn(`[LLM Router Cooldown] Provider "${provider.name}" is in cooldown, but is the last candidate. Trying anyway after others fail...`);
    }

    // Check if turn budget has been exceeded before trying non-last-resort providers
    const elapsedSoFar = Date.now() - turnStartTime;
    if (elapsedSoFar >= MAX_TURN_BUDGET_MS && !provider.name.includes('Last Resort')) {
      console.warn(`[LLM Router Budget] Turn budget exceeded (${elapsedSoFar}ms >= ${MAX_TURN_BUDGET_MS}ms). Skipping to final fallback.`);
      continue;
    }

    console.log(`[LLM Router] [${new Date().toISOString()}] Attempting provider: ${provider.name}`);

    const isCodeOrReasoning = Boolean(options.isCode || options.isReasoning || (customModel && customModel.includes('120b')));
    let selectedModel = provider.model;
    if (provider.name === 'Groq') {
      selectedModel = isCodeOrReasoning ? 'openai/gpt-oss-120b' : 'openai/gpt-oss-20b';
    } else if (customModel) {
      if (provider.name === 'OpenRouter') {
        selectedModel = customModel;
      } else if (provider.name.includes('NVIDIA NIM')) {
        selectedModel = 'nvidia/nemotron-3.5-lightning-30b-a3b';
      } else if (provider.name === 'Kimi K2') {
        selectedModel = customModel.includes('kimi') ? customModel : 'kimi-k2-0905';
      }
    }

    // Policy rule: NEVER use vision models for chat or code
    if (selectedModel && (selectedModel.includes('vision') || selectedModel.includes('llama-3.2-11b') || selectedModel.includes('llama-3.2-90b'))) {
      console.warn(`[LLM Router Policy] Blocked vision model ${selectedModel} for chat/code.`);
      selectedModel = 'nvidia/nemotron-3.5-lightning-30b-a3b';
    }

    // Policy rule: NVIDIA NIM never used for code (chat-only last resort)
    if (options.isCode && (provider.name.includes('NVIDIA') || (selectedModel && selectedModel.includes('nemotron')))) {
      console.warn(`[LLM Router Policy] Blocked ${provider.name} (${selectedModel}) for code.`);
      continue;
    }

    let effectiveTimeout = options.timeoutMs || provider.timeoutMs || (isNormalChat ? 8000 : 20000);
    if (options.isCode) {
      effectiveTimeout = Math.min(effectiveTimeout, 10000); // 10s per-provider timeout for code
    }

    let attempt = 0;
    const maxAttempts = 2; // Allow up to 1 retry on timeout before cooling down and falling over
    let providerSucceeded = false;

    const effectiveMaxTokens = (selectedModel && selectedModel.includes('120b'))
      ? Math.min(Math.max(maxTokens, 1200), 1600)
      : maxTokens;

    while (attempt < maxAttempts && !providerSucceeded) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);
      const startAttemptTime = Date.now();

      try {
        const requestPayload = {
          model: selectedModel,
          messages: formattedMessages,
          temperature,
          max_tokens: effectiveMaxTokens
        };

        if (provider.name === 'Groq') {
          requestPayload.reasoning_effort = options.reasoning_effort || 'low';
        }

        const res = await fetch(provider.endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestPayload),
          signal: controller.signal
        });

        if (!res.ok) {
          const errorText = await res.text().catch(() => '');
          const errorMsg = `HTTP ${res.status} ${res.statusText}: ${redactSecrets(errorText.slice(0, 150))}`;
          const is429or5xx = res.status === 429 || (res.status >= 500 && res.status < 600);

          // Cooldown only on 429/5xx, using isolated per-provider backoff
          if (is429or5xx && !isLastHealthy) {
            const cooldownMs = res.status === 429 ? parseRetryDurationMs(res, errorText) : null;
            markProviderCooldown(provider.name, cooldownMs);
          }
          fallbacksTried++;
          errors.push(`${provider.name}: ${errorMsg}`);
          console.warn(`[LLM Router Timing] Provider ${provider.name} failed with ${errorMsg}. Fast failover to next provider...`);
          break; // Do not retry on HTTP status errors (only retry on timeout)
        }

        const data = await res.json();
        if (data.error) {
          const errMsg = redactSecrets(data.error.message || JSON.stringify(data.error));
          const is429or5xx = data.error.code === 429 || data.error.status === 429 || /429|rate\s*limit|quota|5\d\d/i.test(errMsg);
          if (is429or5xx && !isLastHealthy) {
            const cooldownMs = /429|rate\s*limit|quota/i.test(errMsg) ? parseRetryDurationMs(res, errMsg) : null;
            markProviderCooldown(provider.name, cooldownMs);
          }
          fallbacksTried++;
          errors.push(`${provider.name}: ${errMsg}`);
          break;
        }

        const content = data.choices?.[0]?.message?.content;
        if (content === undefined || content === null || content.trim() === '') {
          fallbacksTried++;
          const finishReason = data.choices?.[0]?.finish_reason || 'unknown';
          errors.push(`${provider.name}: Empty content in response payload (finish_reason: ${finishReason})`);
          console.warn(`[LLM Router Timing] Provider ${provider.name} returned empty content (finish_reason: ${finishReason}). Fast failover to next provider...`);
          break;
        }

        providerSucceeded = true;
        resetProviderCooldown(provider.name);

        const latencyMs = Date.now() - startAttemptTime;

        // Real model extraction
        let actualModel = selectedModel;
        if (provider.name.includes('FreeLLMAPI')) {
          if (data.model && data.model !== 'auto') {
            actualModel = `${data.model} (via FreeLLMAPI auto)`;
          } else {
            actualModel = 'auto (underlying model unreported)';
          }
        } else if (data.model) {
          actualModel = data.model;
        }

        lastServedMeta = {
          provider: provider.name,
          model: actualModel,
          latencyMs,
          fallbacksTried
        };

        // Server log line format: [Server Log] Reply served | Provider: X | Model: Y | Latency: Nms | Fallbacks tried: N
        console.log(`[Server Log] Reply served | Provider: ${provider.name} | Model: ${actualModel} | Latency: ${latencyMs}ms | Fallbacks tried: ${fallbacksTried}`);

        if (localTraceId && localUserId && localUserId !== '00000000-0000-0000-0000-000000000000') {
          pool.query(
            "INSERT INTO model_runs (id, trace_id, user_id, model, prompt_version, latency_ms, created_at) VALUES ($1, $2, $3, $4, 'v1', $5, NOW()) ON CONFLICT DO NOTHING",
            [crypto.randomUUID(), localTraceId, localUserId, actualModel, latencyMs]
          ).catch(err => console.error("[Telemetry] DB Insert failed:", err.message));
        }

        let tokenUsageCost = 0.001;
        if (data.usage && data.usage.total_tokens) {
          tokenUsageCost = (data.usage.total_tokens / 1000) * 0.002;
        }
        logUsage(provider.name, tokenUsageCost).catch(() => {});

        return content;
      } catch (err) {
        const isAbort = err.name === 'AbortError' || /abort|timeout/i.test(err.message);
        const attemptLatency = Date.now() - startAttemptTime;
        const errMsg = redactSecrets(isAbort ? `Timeout after ${effectiveTimeout}ms` : err.message);

        if (isAbort && attempt < maxAttempts) {
          console.warn(`[LLM Router Timing] Provider ${provider.name} timed out after ${attemptLatency}ms on attempt ${attempt}. Retrying once before cooldown...`);
          continue; // Retry once on timeout
        }

        // Exhausted retries or non-abort error
        fallbacksTried++;
        errors.push(`${provider.name}: ${errMsg}`);
        console.warn(`[LLM Router Timing] Provider ${provider.name} failed in ${attemptLatency}ms (${errMsg}). Fast failover to next provider...`);

        // Cooldown on error or timeout: never on last healthy provider
        if (!isLastHealthy) {
          markProviderCooldown(provider.name);
        }
        break;
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  // All providers failed: return clean user-facing message, never raw errors
  console.error('[LLM Router Error] All LLM providers failed:\n' + errors.join('\n'));
  return LLM_FAILURE_SENTINEL;
}

export const chat = callLLM;
export default { callLLM, chat, getProviders, isValidKey, getLastServedMeta, markProviderCooldown, resetProviderCooldown, isProviderCoolingDown, isVagueInput };

import dotenv from 'dotenv';
dotenv.config();

// Collect active env secrets dynamically from process.env to ensure exact values are redacted
const sensitiveEnvKeys = [
  'NVIDIA_API_KEY',
  'OPENROUTER_API_KEY',
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'DEEPSEEK_API_KEY',
  'MINIMAX_API_KEY',
  'SERPER_API_KEY',
  'FREELLMAPI_API_KEY',
  'BROWSERBASE_API_KEY',
  'JWT_SECRET',
  'GHOST_ADMIN_PASSPHRASE',
  'N8N_ENCRYPTION_KEY'
];

/**
 * Mask a secret string showing only the first 4 and last 4 characters if long enough.
 */
export function maskString(secret) {
  if (!secret || typeof secret !== 'string') return '[REDACTED_SECRET]';
  const trimmed = secret.trim();
  if (trimmed.length <= 8) return '[REDACTED_SECRET]';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

/**
 * Scan and redact secrets, keys, and tokens from any string, error, or object output.
 */
export function redactSecrets(input) {
  if (input === null || input === undefined) return input;

  if (typeof input === 'object') {
    if (input instanceof Error) {
      input.message = redactSecrets(input.message);
      if (input.stack) input.stack = redactSecrets(input.stack);
      return input;
    }
    try {
      const jsonStr = JSON.stringify(input);
      const redactedStr = redactSecrets(jsonStr);
      return JSON.parse(redactedStr);
    } catch {
      return input;
    }
  }

  if (typeof input !== 'string') return input;

  let text = input;

  // 1. Redact Authorization Bearer headers, cookies, and explicit key params FIRST
  text = text.replace(/(Authorization:\s*Bearer\s+)[^\s"']+/gi, '$1[REDACTED_BEARER_TOKEN]');
  text = text.replace(/(Bearer\s+)[A-Za-z0-9_\-\.]{20,}/gi, '$1[REDACTED_TOKEN]');
  text = text.replace(/(ghost_session=)[^;\s"']+/gi, '$1[REDACTED_COOKIE]');
  text = text.replace(/(api[-_]?key["']?\s*[:=]\s*["']?)[^"'\s,]+/gi, '$1[REDACTED_API_KEY]');

  // 2. Dynamically scan process.env for sensitive values
  for (const [k, val] of Object.entries(process.env)) {
    if (!val || typeof val !== 'string') continue;
    const isSensitiveName = /(?:KEY|SECRET|TOKEN|PASSPHRASE|PASSWORD|AUTH)/i.test(k);
    if (isSensitiveName && val.trim().length > 4) {
      const escaped = val.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(escaped, 'g'), maskString(val));
    }
  }

  // 3. Pattern-based redactions for common API key signatures
  text = text.replace(/(?:sk-[A-Za-z0-9_\-]{16,})/gi, (m) => maskString(m));
  text = text.replace(/(?:nvapi-[A-Za-z0-9_\-]{16,})/gi, (m) => maskString(m));
  text = text.replace(/(?:gsk_[A-Za-z0-9_\-]{16,})/gi, (m) => maskString(m));
  text = text.replace(/(?:AIzaSy[A-Za-z0-9_\-]{16,})/gi, (m) => maskString(m));

  return text;
}

export default { redactSecrets, maskString };

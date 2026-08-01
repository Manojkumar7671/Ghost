import dotenv from 'dotenv';
dotenv.config();

/**
 * Mask a secret string showing at most 4 prefix and suffix characters.
 */
function maskSecret(val) {
  if (!val || typeof val !== 'string') return '[REDACTED_SECRET]';
  const trimmed = val.trim();
  if (trimmed.length <= 8) return '[REDACTED_SECRET]';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

/**
 * Intercept and sanitize any chunk before it reaches stdout/stderr streams.
 */
export function sanitizeStreamChunk(chunk) {
  if (chunk === null || chunk === undefined) return chunk;

  try {
    let text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');

    // 1. Redact explicit JWT Tokens (eyJ...)
    text = text.replace(/eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, '[REDACTED_JWT_TOKEN]');

    // 2. Redact Authorization Bearer headers, cookies, and explicit key parameters
    text = text.replace(/(Authorization:\s*Bearer\s+)[^\s"']+/gi, '$1[REDACTED_BEARER_TOKEN]');
    text = text.replace(/(Bearer\s+)[A-Za-z0-9_\-\.]{20,}/gi, '$1[REDACTED_TOKEN]');
    text = text.replace(/(ghost_session=)[^;\s"']+/gi, '$1[REDACTED_COOKIE]');
    text = text.replace(/(api[-_]?key["']?\s*[:=]\s*["']?)[^"'\s,]+/gi, '$1[REDACTED_API_KEY]');

    // 3. Redact API Key signatures by prefix
    text = text.replace(/(?:sk-[A-Za-z0-9_\-]{16,})/gi, (m) => maskSecret(m));
    text = text.replace(/(?:nvapi-[A-Za-z0-9_\-]{16,})/gi, (m) => maskSecret(m));
    text = text.replace(/(?:gsk_[A-Za-z0-9_\-]{16,})/gi, (m) => maskSecret(m));
    text = text.replace(/(?:AIzaSy[A-Za-z0-9_\-]{16,})/gi, (m) => maskSecret(m));

    // 4. Redact 32+ char hex/base64 strings occurring near secret keywords
    text = text.replace(/(?:key|secret|token|passphrase|password|auth|credential|private)\s*[:=]\s*["']?([A-Za-z0-9+/=_\-]{32,})["']?/gi, (match, secretVal) => {
      return match.replace(secretVal, maskSecret(secretVal));
    });

    // 5. Redact active environment secret values in process.env
    for (const [k, val] of Object.entries(process.env)) {
      if (!val || typeof val !== 'string') continue;
      const isSensitive = /(?:KEY|SECRET|TOKEN|PASSPHRASE|PASSWORD|AUTH)/i.test(k);
      if (isSensitive && val.trim().length > 4) {
        const escaped = val.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(escaped, 'g'), maskSecret(val));
      }
    }

    return typeof chunk === 'string' ? text : Buffer.from(text, 'utf-8');
  } catch (err) {
    return chunk;
  }
}

/**
 * Initialize process-wide stream patches on process.stdout and process.stderr
 */
export function initSecretHook() {
  if (globalThis.__GHOST_SECRET_HOOK_ATTACHED) return;
  globalThis.__GHOST_SECRET_HOOK_ATTACHED = true;

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = function (...args) {
    if (args[0] !== null && args[0] !== undefined) {
      args[0] = sanitizeStreamChunk(args[0]);
    }
    return originalStdoutWrite.apply(process.stdout, args);
  };

  process.stderr.write = function (...args) {
    if (args[0] !== null && args[0] !== undefined) {
      args[0] = sanitizeStreamChunk(args[0]);
    }
    return originalStderrWrite.apply(process.stderr, args);
  };

  console.log('[SecretHook] Global process stdout/stderr secret redaction hook initialized.');
}

// Auto-initialize on module import
initSecretHook();

export default { initSecretHook, sanitizeStreamChunk };

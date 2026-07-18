/**
 * Ghost AI Security Middleware
 * Provides input sanitization, prompt injection detection, and request validation.
 */

// Patterns that indicate prompt injection attacks
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+(all\s+)?above\s+instructions/i,
  /disregard\s+(all\s+)?previous/i,
  /you\s+are\s+now\s+(?:a\s+)?(?:new|different)/i,
  /forget\s+(all\s+)?(?:your|previous)\s+instructions/i,
  /override\s+(?:your\s+)?(?:system|instructions|rules)/i,
  /pretend\s+(?:you\s+are|to\s+be)\s+(?:a\s+)?(?:different|new)/i,
  /system\s*:\s*you\s+are/i,
  /\[SYSTEM\]\s*:/i,
  /\<\|im_start\|\>system/i,
  /\<\|endoftext\|\>/i,
  /\<\|system\|\>/i,
  /print\s*\(\s*['"].*(?:API_KEY|SECRET|PASSWORD|TOKEN)/i,
  /process\.env\./i,
  /(?:echo|cat|env|printenv)\s+.*(?:KEY|SECRET|PASS|TOKEN)/i,
  /(?:rm\s+-rf|sudo|chmod\s+777|mkfs|dd\s+if=)/i
];

// XSS sanitization patterns
const XSS_PATTERNS = [
  /<script[\s>]/gi,
  /javascript\s*:/gi,
  /on(?:load|error|click|mouseover)\s*=/gi,
  /eval\s*\(/gi,
  /document\.(?:cookie|write|location)/gi,
  /window\.(?:location|open)/gi
];

/**
 * Sanitize user input text by stripping dangerous patterns
 */
function sanitizeInput(text) {
  if (!text || typeof text !== 'string') return text;
  
  let sanitized = text;
  
  // Strip XSS patterns
  for (const pattern of XSS_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[BLOCKED]');
  }
  
  return sanitized.trim();
}

/**
 * Detect prompt injection attempts in user messages
 * Returns { safe: boolean, reason: string }
 */
function detectPromptInjection(message) {
  if (!message || typeof message !== 'string') return { safe: true };
  
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(message)) {
      return { 
        safe: false, 
        reason: `Blocked: Input matched security pattern. Your message was flagged as a potential prompt injection.`
      };
    }
  }
  
  return { safe: true };
}

/**
 * Express middleware that validates and sanitizes incoming chat requests
 */
function securityMiddleware(req, res, next) {
  // Validate Content-Type for POST requests
  if (req.method === 'POST' && !req.is('application/json')) {
    return res.status(415).json({ success: false, error: 'Content-Type must be application/json' });
  }
  
  // Validate request body exists
  if (req.method === 'POST' && (!req.body || typeof req.body !== 'object')) {
    return res.status(400).json({ success: false, error: 'Invalid request body' });
  }
  
  // For chat endpoints, sanitize and check for injection
  if (req.body && req.body.message) {
    const injection = detectPromptInjection(req.body.message);
    if (!injection.safe) {
      console.warn(`[Security] Prompt injection blocked from IP ${req.ip}: ${req.body.message.substring(0, 100)}`);
      return res.status(403).json({ success: false, error: injection.reason });
    }
    
    // Sanitize the message
    req.body.message = sanitizeInput(req.body.message);
  }
  
  // Sanitize user field
  if (req.body && req.body.user) {
    req.body.user = sanitizeInput(req.body.user);
    // Restrict user field length
    if (req.body.user.length > 100) {
      req.body.user = req.body.user.substring(0, 100);
    }
  }
  
  next();
}

export { securityMiddleware, sanitizeInput, detectPromptInjection };

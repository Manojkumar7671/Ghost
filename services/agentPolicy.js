import crypto from 'crypto';

// Bounded limits
const MAX_RETRIES = 3;
const MAX_CHANGED_FILES = 10;
const MAX_DEADLINE_MS = 1000 * 60 * 60 * 24; // 24 hours max from creation

// Fixed executable allowlist
const ALLOWED_EXECUTABLES = ['npm', 'node'];
const BANNED_EXECUTABLES = ['sh', 'bash', 'zsh', 'eval', 'sudo', 'ruby', 'python', 'perl'];
const BANNED_ARGS = [';', '&&', '||', '|', '>', '<', '>>', '`', '$('];
const BANNED_PATHS = ['.env', '.git', '.ssh', 'credentials', 'config'];

class PolicyViolationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PolicyViolationError';
  }
}

/**
 * Validates a single path string to ensure it's a safe, normalized relative path
 * @param {string} p 
 * @returns {string} The normalized path
 */
function validateRelativePath(p) {
  if (!p || typeof p !== 'string') {
    throw new PolicyViolationError("Path must be a non-empty string");
  }

  // Reject absolute paths
  if (p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z]:/.test(p)) {
    throw new PolicyViolationError(`Absolute paths are not allowed: ${p}`);
  }

  // Normalize
  const normalized = p.split(/[\/\\]+/).filter(segment => segment !== '.' && segment !== '');
  
  if (normalized.length === 0) {
    throw new PolicyViolationError("Empty path after normalization");
  }

  // Check for directory traversal
  if (normalized.includes('..')) {
    throw new PolicyViolationError(`Directory traversal (..) is not allowed: ${p}`);
  }

  // Check for blocked directories/files
  for (const segment of normalized) {
    if (BANNED_PATHS.includes(segment)) {
      throw new PolicyViolationError(`Access to ${segment} is blocked: ${p}`);
    }
    if (segment.startsWith('.env') || segment.includes('.pem') || segment.includes('.key')) {
      throw new PolicyViolationError(`Access to sensitive file pattern blocked: ${p}`);
    }
  }

  return normalized.join('/');
}

/**
 * Validates a structured command { executable, args }
 * @param {object} cmd 
 */
function validateCommand(cmd) {
  if (!cmd || typeof cmd !== 'object') {
    throw new PolicyViolationError("Command must be an object with executable and args");
  }
  
  const { executable, args } = cmd;

  if (!executable || typeof executable !== 'string') {
    throw new PolicyViolationError("Command executable must be a string");
  }

  if (BANNED_EXECUTABLES.includes(executable)) {
    throw new PolicyViolationError(`Executable ${executable} is explicitly banned`);
  }

  if (!ALLOWED_EXECUTABLES.includes(executable)) {
    throw new PolicyViolationError(`Executable ${executable} is not in the allowlist`);
  }

  if (!Array.isArray(args)) {
    throw new PolicyViolationError("Command args must be an array of strings");
  }

  for (const arg of args) {
    if (typeof arg !== 'string') {
      throw new PolicyViolationError("Command arguments must be strings");
    }
    if (arg.includes('\n')) {
      throw new PolicyViolationError("Newlines are not allowed in command arguments");
    }
    for (const banned of BANNED_ARGS) {
      if (arg.includes(banned)) {
        throw new PolicyViolationError(`Banned shell character/sequence '${banned}' in arguments`);
      }
    }
  }

  return { executable, args };
}

/**
 * Validates the full plan schema and returns a normalized copy.
 * Rejects unknown fields and enforces strict boundaries.
 * 
 * @param {object} plan 
 * @returns {object} Normalized, validated plan
 */
function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new PolicyViolationError("Plan must be a valid object");
  }

  const allowedFields = [
    'repoProfileId', 
    'description', 
    'route', 
    'allowedPaths', 
    'testCommand', 
    'deadline', 
    'maxRetries', 
    'maxChangedFiles'
  ];

  for (const key of Object.keys(plan)) {
    if (!allowedFields.includes(key)) {
      throw new PolicyViolationError(`Unknown field in plan: ${key}`);
    }
  }

  // 1. repoProfileId
  if (!plan.repoProfileId || typeof plan.repoProfileId !== 'string') {
    throw new PolicyViolationError("repoProfileId must be a valid non-empty string");
  }

  // 2. description
  if (!plan.description || typeof plan.description !== 'string' || plan.description.trim().length === 0) {
    throw new PolicyViolationError("description must be a non-empty string");
  }

  // 3. route
  if (plan.route !== 'mac') {
    throw new PolicyViolationError(`Invalid route: ${plan.route}. Only 'mac' is supported.`);
  }

  // 4. allowedPaths
  if (!Array.isArray(plan.allowedPaths) || plan.allowedPaths.length === 0) {
    throw new PolicyViolationError("allowedPaths must be a non-empty array of path patterns");
  }
  const normalizedPaths = plan.allowedPaths.map(validateRelativePath);

  // 5. testCommand
  const validatedCommand = validateCommand(plan.testCommand);

  // 6. deadline
  const now = Date.now();
  const deadline = parseInt(plan.deadline, 10);
  if (isNaN(deadline) || deadline <= now) {
    throw new PolicyViolationError("deadline must be a future timestamp in milliseconds");
  }
  if (deadline - now > MAX_DEADLINE_MS) {
    throw new PolicyViolationError("deadline exceeds maximum allowed duration");
  }

  // 7. maxRetries
  let maxRetries = plan.maxRetries;
  if (maxRetries !== undefined) {
    if (typeof maxRetries !== 'number' || maxRetries < 0 || maxRetries > MAX_RETRIES) {
      throw new PolicyViolationError(`maxRetries must be between 0 and ${MAX_RETRIES}`);
    }
  } else {
    maxRetries = 0;
  }

  // 8. maxChangedFiles
  let maxChangedFiles = plan.maxChangedFiles;
  if (maxChangedFiles !== undefined) {
    if (typeof maxChangedFiles !== 'number' || maxChangedFiles < 1 || maxChangedFiles > MAX_CHANGED_FILES) {
      throw new PolicyViolationError(`maxChangedFiles must be between 1 and ${MAX_CHANGED_FILES}`);
    }
  } else {
    maxChangedFiles = MAX_CHANGED_FILES;
  }

  return {
    repoProfileId: plan.repoProfileId,
    description: plan.description.trim(),
    route: plan.route,
    allowedPaths: normalizedPaths,
    testCommand: validatedCommand,
    deadline: deadline,
    maxRetries: maxRetries,
    maxChangedFiles: maxChangedFiles
  };
}

/**
 * Canonically serializes an object with stable key ordering.
 * 
 * @param {any} obj 
 * @returns {string} JSON string
 */
function canonicalize(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  let str = '{';
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    str += JSON.stringify(key) + ':' + canonicalize(obj[key]);
    if (i < keys.length - 1) str += ',';
  }
  str += '}';
  return str;
}

/**
 * Generates a SHA-256 hash of a normalized plan.
 * 
 * @param {object} plan 
 * @returns {string}
 */
function hashPlan(plan) {
  const normalized = validatePlan(plan); // Ensure it's valid before hashing
  const serialized = canonicalize(normalized);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

/**
 * Compares an incoming plan against a known hash. Fails closed on mismatch.
 * 
 * @param {object} plan 
 * @param {string} expectedHash 
 * @returns {boolean} true if match
 */
function verifyPlanHash(plan, expectedHash) {
  try {
    const currentHash = hashPlan(plan);
    if (currentHash !== expectedHash) {
      throw new PolicyViolationError("Plan hash mismatch. The plan has been altered.");
    }
    return true;
  } catch (err) {
    throw new PolicyViolationError("Verification failed: " + err.message);
  }
}

export {
  validatePlan,
  validateRelativePath,
  validateCommand,
  canonicalize,
  hashPlan,
  verifyPlanHash,
  PolicyViolationError
};

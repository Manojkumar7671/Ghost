import { execSync } from 'child_process';

/**
 * Runs an optional pre-execution reasoning step using Claude Code CLI.
 * Toggleable via CLAUDE_PRESTEP_ENABLED=true.
 */
export function runClaudeReasoningPrestep(userPrompt = '') {
  const isEnabled = process.env.CLAUDE_PRESTEP_ENABLED === 'true';
  if (!isEnabled) {
    return { enabled: false, reasoning: null, reason: 'CLAUDE_PRESTEP_ENABLED is not set to true' };
  }

  try {
    // Check if claude command exists on PATH
    execSync('which claude', { stdio: 'pipe' });
  } catch (err) {
    console.warn('[Claude Pre-Step] Claude CLI ("claude") not found on PATH. Skipping pre-step.');
    return { enabled: true, reasoning: null, reason: 'Claude CLI ("claude") not installed or not on PATH' };
  }

  try {
    console.log('[Claude Pre-Step] Invoking Claude Code CLI for pre-execution reasoning...');
    const safePrompt = String(userPrompt).replace(/"/g, '\\"');
    const stdout = execSync(`claude -p "Provide a brief 2-sentence tactical plan for: ${safePrompt}" < /dev/null`, {
      timeout: 5000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    }).trim();

    console.log('[Claude Pre-Step Output]:', stdout.slice(0, 150));
    return { enabled: true, reasoning: stdout, reason: null };
  } catch (err) {
    console.warn('[Claude Pre-Step Failed]:', err.message);
    return { enabled: true, reasoning: null, reason: err.message };
  }
}

export default { runClaudeReasoningPrestep };

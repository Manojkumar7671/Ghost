export function classifyCommand(command) {
  const dangerousPatterns = [
    /\brm\s+(?:-[^\s]*[rf][^\s]*\s*)+/i, // catches rm -rf, rm -fr, rm -r -f
    /\bunlink\b/i,
    /\bcd\s+\.\./i,
    /curl\s+.*\|\s*(?:bash|sh|zsh)/i,
    /wget\s+.*\|\s*(?:bash|sh|zsh)/i,
    /sudo\s+/i,
    /\/etc\/passwd|\.aws\/credentials|\.env/i,
    /\.\.\// // Path traversal/workspace escape attempts
  ];

  const isDangerous = dangerousPatterns.some(regex => regex.test(command));
  if (isDangerous) {
    return { safe: false, reason: "Security violation: Dangerous system command modifier or path traversal detected." };
  }
  return { safe: true };
}

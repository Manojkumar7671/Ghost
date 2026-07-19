export function classifyCommand(command) {
  const dangerousPatterns = [
    /rm\s+-rf/i,
    /curl\s+.*\|\s*bash/i,
    /wget\s+.*\|\s*bash/i,
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

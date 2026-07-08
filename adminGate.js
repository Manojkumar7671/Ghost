const ADMIN_ID = 'master_manoj';

// List every tool name that should be admin-only.
const RESTRICTED_TOOLS = new Set([
  'execSync',
  'shellExec',
  'fileWrite',
  'fileDelete',
  'deploy',
  'gitPush',
  'memoryWrite',
  'pipelineControl',
  'envUpdate',
  'browserbase_execute',
  'n8n_execute',
]);

/**
 * Call this before executing any restricted tool.
 * @param {string} toolName - name of the tool being invoked
 * @param {string} safeUser - the normalized user id
 * @returns {{allowed: boolean, reason?: string}}
 */
function checkToolAccess(toolName, safeUser) {
  if (!RESTRICTED_TOOLS.has(toolName)) {
    return { allowed: true };
  }
  if (safeUser === ADMIN_ID) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Tool "${toolName}" is admin-only. Access denied for user "${safeUser || 'guest'}".`,
  };
}

export { checkToolAccess, RESTRICTED_TOOLS, ADMIN_ID };

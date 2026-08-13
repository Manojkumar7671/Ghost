/**
 * authorizationService.js
 * Fine-grained role-based tool access control for Ghost AI.
 */

function checkToolAccess(user = {}, toolName = '', resourceId = '') {
  const role = user ? (user.role || 'guest') : 'guest';
  
  // Admin role allows all tools and resources
  if (role === 'admin') {
    return { allowed: true, reason: 'OK' };
  }

  // Permitted tools for standard users & guests
  const publicTools = ['chat:use', 'memory:read', 'memory:write', 'search:use', 'weather:use'];
  
  const targetPermission = toolName.includes(':') ? toolName : `${toolName}:use`;

  if (publicTools.includes(targetPermission)) {
    return { allowed: true, reason: 'OK' };
  }

  return { 
    allowed: false, 
    reason: `Unauthorized: Tool "${toolName}" on resource "${resourceId || 'default'}" requires elevated permissions.` 
  };
}

module.exports = { checkToolAccess };

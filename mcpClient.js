/**
 * mcpClient.js - Model Context Protocol (MCP) Client for Ghost
 *
 * Connects Ghost to external MCP servers to discover and execute remote tools.
 * Configured via env vars: MCP_SERVER_URL and MCP_SERVER_TOKEN.
 * Fails gracefully when no MCP server is configured.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

let mcpClientInstance = null;
let cachedTools = null;

function getMcpConfig() {
  const url = process.env.MCP_SERVER_URL ? process.env.MCP_SERVER_URL.trim() : '';
  const token = process.env.MCP_SERVER_TOKEN ? process.env.MCP_SERVER_TOKEN.trim() : '';
  return { url, token, isConfigured: Boolean(url) };
}

/**
 * Connects to the configured external MCP server via SSE transport.
 */
async function getConnectedClient() {
  const config = getMcpConfig();
  if (!config.isConfigured) return null;

  if (mcpClientInstance) return mcpClientInstance;

  try {
    const transport = new SSEClientTransport(new URL(config.url), {
      requestInit: config.token ? {
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'X-MCP-Token': config.token
        }
      } : {}
    });

    const client = new Client(
      { name: 'GhostAI-Client', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    await client.connect(transport);
    mcpClientInstance = client;
    console.log(`[MCP Client] Connected to MCP server at ${config.url}`);
    return mcpClientInstance;
  } catch (err) {
    console.warn(`[MCP Client] Failed to connect to MCP server (${config.url}): ${err.message}. Skipping MCP tools.`);
    return null;
  }
}

/**
 * Lists all available tools exposed by the connected MCP server.
 *
 * @returns {Promise<Array<Object>>} List of tool objects [{ name, description, inputSchema }]
 */
export async function listMcpTools() {
  const config = getMcpConfig();
  if (!config.isConfigured) return [];

  if (cachedTools) return cachedTools;

  try {
    const client = await getConnectedClient();
    if (!client) return [];

    const response = await client.listTools();
    cachedTools = (response.tools || []).map(t => ({
      name: `mcp_${t.name}`,
      originalName: t.name,
      description: t.description || 'External MCP Tool',
      inputSchema: t.inputSchema || {}
    }));

    return cachedTools;
  } catch (err) {
    console.warn(`[MCP Client] Error listing tools: ${err.message}`);
    return [];
  }
}

/**
 * Executes a tool on the connected MCP server.
 *
 * @param {string} toolName - Name of the tool (with or without 'mcp_' prefix)
 * @param {Object} args - Parameter arguments for the tool
 * @returns {Promise<Object>} Execution response content
 */
export async function callMcpTool(toolName, args = {}) {
  const config = getMcpConfig();
  if (!config.isConfigured) {
    return { error: 'MCP client is not configured. Set MCP_SERVER_URL in environment.' };
  }

  try {
    const client = await getConnectedClient();
    if (!client) throw new Error('LOCAL_BRIDGE_UNAVAILABLE: local tool bridge unavailable—nothing was run.');

    const targetName = toolName.replace(/^mcp_/, '');
    const res = await client.callTool({ name: targetName, arguments: args });
    return { success: true, result: res.content || res };
  } catch (err) {
    console.error(`[MCP Client] Error calling tool "${toolName}":`, err.message);
    return { error: `MCP tool execution failed: ${err.message}` };
  }
}

export default {
  listMcpTools,
  callMcpTool
};

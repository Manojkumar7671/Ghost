/**
 * Ghost Internal Workflow Engine
 * Replaces n8n — a self-contained workflow runner built natively into Ghost.
 * Supports: webhooks, scheduled jobs, and custom action chains.
 * No external dependency. No 401 errors. No cloud required.
 */
import { execFileSync } from 'child_process';
import { assertSafeUrl, safeFetch } from './urlSafety.js';

const SAFE_WORKFLOW_ID = /^[a-zA-Z0-9_-]+$/;

class GhostWorkflowEngine {
    constructor() {
        this.isConnected = true; // Always connected — it's built in
        this.workflows = new Map();
        this._registerBuiltinWorkflows();
    }

    _registerBuiltinWorkflows() {
        this.workflows.set('send_webhook', {
            name: 'send_webhook',
            description: 'Send a POST request to any external webhook URL with a custom payload.',
            inputSchema: {
                properties: {
                    url: { type: 'string', description: 'The webhook endpoint URL' },
                    payload: { type: 'object', description: 'JSON payload to send' }
                }
            },
            handler: async (args) => {
                const { url, payload } = args;
                if (!url) throw new Error('Workflow "send_webhook" requires a "url" argument.');
                const res = await safeFetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
                return { status: res.status, ok: res.ok, message: `Webhook delivered to ${url}` };
            }
        });

        this.workflows.set('fetch_data', {
            name: 'fetch_data',
            description: 'Fetch JSON or text data from any external URL via GET request.',
            inputSchema: {
                properties: {
                    url: { type: 'string', description: 'The URL to fetch data from' },
                    headers: { type: 'object', description: 'Optional HTTP headers' }
                }
            },
            handler: async (args) => {
                const { url, headers = {} } = args;
                if (!url) throw new Error('Workflow "fetch_data" requires a "url" argument.');
                const res = await safeFetch(url, { headers });
                const contentType = res.headers.get('content-type') || '';
                const data = contentType.includes('json') ? await res.json() : await res.text();
                return { status: res.status, data };
            }
        });

        this.workflows.set('log_event', {
            name: 'log_event',
            description: 'Log a structured event or message to the Ghost system console.',
            inputSchema: {
                properties: {
                    event: { type: 'string', description: 'Event name or type' },
                    data: { type: 'object', description: 'Event data payload' }
                }
            },
            handler: async (args) => {
                const { event, data } = args;
                console.log(`[Ghost Workflow Event] ${event}:`, JSON.stringify(data || {}));
                return { logged: true, event, timestamp: new Date().toISOString() };
            }
        });

        this.workflows.set('send_notification', {
            name: 'send_notification',
            description: 'Send a system notification or alert message.',
            inputSchema: {
                properties: {
                    title: { type: 'string', description: 'Notification title' },
                    message: { type: 'string', description: 'Notification body' }
                }
            },
            handler: async (args) => {
                const { title, message } = args;
                console.log(`[Ghost Notification] 📢 ${title}: ${message}`);
                return { sent: true, title, message };
            }
        });

        this.workflows.set('n8n_webhook', {
            name: 'n8n_webhook',
            description: 'Trigger a workflow webhook on the self-hosted local n8n instance or N8N_MCP_URL.',
            inputSchema: {
                properties: {
                    path: { type: 'string', description: 'The webhook path (e.g., webhook/my-flow or webhook-test/my-flow)' },
                    method: { type: 'string', description: 'HTTP method (GET, POST)' },
                    payload: { type: 'object', description: 'JSON payload to send' }
                }
            },
            handler: async (args) => {
                const { path = '', method = 'POST', payload } = args || {};
                let url;
                if (process.env.N8N_MCP_URL) {
                    url = process.env.N8N_MCP_URL;
                    if (path) {
                        const cleanPath = path.startsWith('/') ? path : `/${path}`;
                        url = `${process.env.N8N_MCP_URL.replace(/\/+$/, '')}${cleanPath}`;
                    }
                } else {
                    if (!path) throw new Error('Workflow "n8n_webhook" requires a "path" argument when N8N_MCP_URL is not set.');
                    const cleanPath = path.startsWith('/') ? path : `/${path}`;
                    url = `http://localhost:5678/n8n${cleanPath}`;
                }

                const headers = { 'Content-Type': 'application/json' };
                if (process.env.N8N_MCP_TOKEN) {
                    headers['X-N8N-Token'] = process.env.N8N_MCP_TOKEN;
                    headers['Authorization'] = `Bearer ${process.env.N8N_MCP_TOKEN}`;
                }

                const fetchOpts = { method, headers };
                if (method === 'POST' && payload) {
                    fetchOpts.body = JSON.stringify(payload);
                }

                const res = await fetch(url, fetchOpts);
                const responseText = await res.text();
                let jsonResponse;
                try { jsonResponse = JSON.parse(responseText); } catch (e) { jsonResponse = responseText; }
                return { status: res.status, ok: res.ok, response: jsonResponse, url };
            }
        });

        this.workflows.set('n8n_execute', {
            name: 'n8n_execute',
            description: 'Execute a saved n8n workflow directly by its ID.',
            inputSchema: {
                properties: {
                    workflowId: { type: 'string', description: 'The n8n workflow ID (e.g., "1")' },
                    payload: { type: 'object', description: 'Optional input payload' }
                }
            },
            handler: async (args) => {
                const { workflowId, payload } = args;
                if (!workflowId) throw new Error('Workflow "n8n_execute" requires a "workflowId" argument.');
                if (!SAFE_WORKFLOW_ID.test(workflowId)) {
                    throw new Error('Invalid workflowId format — must be alphanumeric, dashes, or underscores only.');
                }
                const n8nEnv = {
                    ...process.env,
                    N8N_PORT: '5678',
                    N8N_PATH: '/n8n/'
                    // Intentionally no DB_TYPE/DB_POSTGRESDB_* here — n8n runs on its own
                    // isolated SQLite store (see server.js startN8n()), not Ghost's shared
                    // Supabase pool. Reconnecting it here would reintroduce pool contention.
                };
                const output = execFileSync('npx', ['n8n', 'execute', '--id', workflowId], { env: n8nEnv, encoding: 'utf-8' });
                return { success: true, workflowId, output: output.trim() };
            }
        });
    }

    getPromptString() {
        const entries = [...this.workflows.values()];
        return entries.map(w =>
            `- Action Name: "${w.name}"\n  Description: ${w.description}\n  Payload Schema: ${JSON.stringify(w.inputSchema?.properties || {})}`
        ).join('\n\n');
    }

    async executeTool(name, args) {
        const workflow = this.workflows.get(name);
        if (!workflow) {
            throw new Error(`Ghost Workflow Engine: Unknown workflow "${name}". Available: ${[...this.workflows.keys()].join(', ')}`);
        }
        try {
            const result = await workflow.handler(args);
            console.log(`[Ghost Workflow] ✅ Executed "${name}" successfully.`);
            return result;
        } catch (err) {
            console.error(`[Ghost Workflow] ❌ "${name}" failed:`, err.message);
            throw err;
        }
    }

    register(name, description, inputSchema, handler) {
        this.workflows.set(name, { name, description, inputSchema, handler });
        console.log(`[Ghost Workflow] Registered custom workflow: "${name}"`);
    }

    async testN8nWebhook(payload = { ping: true, source: 'ghost_test' }) {
        const handler = this.workflows.get('n8n_webhook')?.handler;
        if (!handler) throw new Error('n8n_webhook handler not registered.');
        return await handler({ path: '', method: 'POST', payload });
    }
}

export default new GhostWorkflowEngine();

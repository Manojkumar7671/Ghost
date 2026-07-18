/**
 * Ghost Internal Workflow Engine
 * Replaces n8n — a self-contained workflow runner built natively into Ghost.
 * Supports: webhooks, scheduled jobs, and custom action chains.
 * No external dependency. No 401 errors. No cloud required.
 */

class GhostWorkflowEngine {
    constructor() {
        this.isConnected = true; // Always connected — it's built in
        this.workflows = new Map();
        this._registerBuiltinWorkflows();
    }

    /**
     * Built-in workflows that Ghost can trigger natively
     */
    _registerBuiltinWorkflows() {
        // Send a webhook to an external URL
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
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
                return { status: res.status, ok: res.ok, message: `Webhook delivered to ${url}` };
            }
        });

        // Fetch data from a URL and return the response
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
                const res = await fetch(url, { headers });
                const contentType = res.headers.get('content-type') || '';
                const data = contentType.includes('json') ? await res.json() : await res.text();
                return { status: res.status, data };
            }
        });

        // Log a structured event to the console
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

        // Send an email via the environment-configured SMTP (future)
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
    }

    /**
     * Returns a formatted string for the LLM prompt listing available workflows
     */
    getPromptString() {
        const entries = [...this.workflows.values()];
        return entries.map(w =>
            `- Action Name: "${w.name}"\n  Description: ${w.description}\n  Payload Schema: ${JSON.stringify(w.inputSchema?.properties || {})}`
        ).join('\n\n');
    }

    /**
     * Execute a workflow by name with given arguments
     */
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

    /**
     * Register a custom workflow at runtime
     */
    register(name, description, inputSchema, handler) {
        this.workflows.set(name, { name, description, inputSchema, handler });
        console.log(`[Ghost Workflow] Registered custom workflow: "${name}"`);
    }
}

export default new GhostWorkflowEngine();

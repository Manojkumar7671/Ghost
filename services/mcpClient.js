import axios from 'axios';

class N8nMcpClient {
    constructor() {
        this.baseUrl = process.env.N8N_MCP_URL;
        this.token = process.env.N8N_MCP_TOKEN;
        this.isConnected = false;
        this.toolsCache = [];
    }

    async initialize() {
        if (!this.baseUrl || !this.token) {
            console.warn('[MCP Alert] N8N_MCP_URL or N8N_MCP_TOKEN missing. Running without n8n hands.');
            return false;
        }

        try {
            const response = await axios.get(`${this.baseUrl}/tools`, {
                headers: { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' },
                timeout: 5000
            });

            if (response.data && response.data.tools) {
                this.toolsCache = response.data.tools;
                this.isConnected = true;
                console.log(`[MCP Success] Connected to n8n MCP. Registered ${this.toolsCache.length} workflows.`);
                return true;
            }
        } catch (error) {
            console.error('[MCP Error] Failed to connect to n8n instance:', error.message);
            this.isConnected = false;
        }
        return false;
    }

    // Formats the tools so Ghost's LLM knows exactly how to trigger them via the JSON Interceptor
    getPromptString() {
        if (!this.isConnected || this.toolsCache.length === 0) return "No n8n tools currently online.";
        
        return this.toolsCache.map(t => 
            `- Action Name: "${t.name}"\n  Description: ${t.description}\n  Payload Schema: ${JSON.stringify(t.inputSchema?.properties || {})}`
        ).join('\n\n');
    }

    async executeTool(name, args) {
        if (!this.isConnected) throw new Error('n8n MCP endpoint is currently unreachable.');

        try {
            const response = await axios.post(`${this.baseUrl}/tools/call`, 
                { name: name, arguments: args },
                {
                    headers: { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' },
                    timeout: 30000 // Extended timeout for heavy n8n workflows
                }
            );
            return response.data;
        } catch (error) {
            console.error(`[MCP Execution Failure] Workflow ${name} failed:`, error.response?.data || error.message);
            throw new Error(`n8n workflow failed: ${error.response?.data?.message || error.message}`);
        }
    }
}

export default new N8nMcpClient();

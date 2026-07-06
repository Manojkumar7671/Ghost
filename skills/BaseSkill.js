/**
 * Core Skill interface and built-in skill registry.
 * Wired to Ghost's real infrastructure: Serper search, n8nMcpClient for external actions.
 */
export class BaseSkill {
    constructor({ name, inputSchema, outputSchema, requiresApproval = false, execute }) {
        this.name = name;
        this.inputSchema = inputSchema;
        this.outputSchema = outputSchema;
        this.requiresApproval = requiresApproval;
        this._execute = execute;
    }

    async execute(inputs) {
        return await this._execute(inputs);
    }
}

const SERPER_API_KEY = process.env.SERPER_API_KEY;

// --- Skill Implementations (real integrations) ---

export const webSearchSkill = new BaseSkill({
    name: 'webSearch',
    inputSchema: { query: 'string' },
    outputSchema: { results: 'array' },
    requiresApproval: false,
    execute: async (inputs) => {
        console.log(`[Skill: webSearch] Searching: "${inputs.query}"`);
        const res = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: inputs.query })
        });
        const data = await res.json();
        const results = (data.organic || []).slice(0, 3).map(r => `${r.title}: ${r.snippet}`);
        return { results };
    }
});

// n8nMcpClient is injected at registry-build time (see buildSkillRegistry below)
// so this file doesn't need to import server.js directly (avoids circular imports).

export function buildSkillRegistry(n8nMcpClient) {
    const sendEmailSkill = new BaseSkill({
        name: 'sendEmail',
        inputSchema: { workflowName: 'string', payload: 'object' },
        outputSchema: { result: 'object' },
        requiresApproval: true,
        execute: async (inputs) => {
            console.log(`[Skill: sendEmail] Executing n8n workflow: ${inputs.workflowName}`);
            const result = await n8nMcpClient.executeTool(inputs.workflowName, inputs.payload);
            return { result };
        }
    });

    const calendarSkill = new BaseSkill({
        name: 'calendar',
        inputSchema: { workflowName: 'string', payload: 'object' },
        outputSchema: { result: 'object' },
        requiresApproval: true,
        execute: async (inputs) => {
            console.log(`[Skill: calendar] Executing n8n workflow: ${inputs.workflowName}`);
            const result = await n8nMcpClient.executeTool(inputs.workflowName, inputs.payload);
            return { result };
        }
    });

    return {
        webSearch: webSearchSkill,
        sendEmail: sendEmailSkill,
        calendar: calendarSkill
    };
}
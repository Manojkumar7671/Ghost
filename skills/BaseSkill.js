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

// mcpClient is injected at registry-build time (see buildSkillRegistry below)
// so this file doesn't need to import server.js directly (avoids circular imports).

import { businessSkill } from './business/businessSkill.js';
import { nvidiaSkill } from './nvidia_tools/nvidiaSkill.js';

export function buildSkillRegistry(mcpClient, securityAuditSkill) {
    const sendEmailSkill = new BaseSkill({
        name: 'sendEmail',
        inputSchema: { workflowName: 'string', payload: 'object' },
        outputSchema: { result: 'object' },
        requiresApproval: true,
        execute: async (inputs) => {
            console.log(`[Skill: sendEmail] Executing workflow: ${inputs.workflowName}`);
            const result = await mcpClient.executeTool(inputs.workflowName, inputs.payload);
            return { result };
        }
    });

    const calendarSkill = new BaseSkill({
        name: 'calendar',
        inputSchema: { workflowName: 'string', payload: 'object' },
        outputSchema: { result: 'object' },
        requiresApproval: true,
        execute: async (inputs) => {
            console.log(`[Skill: calendar] Executing workflow: ${inputs.workflowName}`);
            const result = await mcpClient.executeTool(inputs.workflowName, inputs.payload);
            return { result };
        }
    });

    // Wrap the business object so it matches the expected interface
    const businessBaseSkill = new BaseSkill({
        name: businessSkill.name,
        inputSchema: businessSkill.inputSchema,
        outputSchema: businessSkill.outputSchema,
        requiresApproval: businessSkill.requiresApproval,
        execute: businessSkill.execute
    });

    // Wrap the nvidia tools object so it matches the expected interface
    const nvidiaBaseSkill = new BaseSkill({
        name: nvidiaSkill.name,
        inputSchema: nvidiaSkill.inputSchema,
        outputSchema: nvidiaSkill.outputSchema,
        requiresApproval: nvidiaSkill.requiresApproval,
        execute: nvidiaSkill.execute
    });

    return {
        webSearch: webSearchSkill,
        sendEmail: sendEmailSkill,
        calendar: calendarSkill,
        securityAudit: securityAuditSkill,
        business_action: businessBaseSkill,
        nvidia_tools: nvidiaBaseSkill
    };
}
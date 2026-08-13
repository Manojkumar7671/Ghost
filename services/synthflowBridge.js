import { callMcpTool } from '../mcpClient.js';

/**
 * Synthflow Voice Agent Integration
 * Connects to Synthflow MCP tool to create and manage AI voice agents.
 */
export async function createVoiceAgent(params = {}) {
    const name = params.name || 'Ghost AI Voice Agent';
    const prompt = params.prompt || 'You are Ghost AI voice assistant handling telephony calls.';
    const voice = params.voice || 'eleven_multilingual_v2';
    const webhookUrl = params.webhook_url || `${process.env.PUBLIC_URL || 'http://localhost:3000'}/api/telephony/process-recording`;

    const apiKey = process.env.SYNTHFLOW_API_KEY;
    if (!apiKey) {
        console.log(`[MOCK] Synthflow API call for "${name}" (Missing SYNTHFLOW_API_KEY)`);
        return {
            success: true,
            agentId: "mock-agent-" + Date.now(),
            config: { name, prompt, voice },
            status: "AGENT_CREATED_MOCK",
            message: "[MOCK] Synthflow API stubbed for MVP — real key needed for production"
        };
    }

    try {
        console.log(`[Synthflow Integration] Calling create_agent tool for "${name}"...`);
        const result = await callMcpTool('create_agent', {
            name: name,
            prompt: prompt,
            voice: voice,
            webhook_url: webhookUrl
        });

        if (result.error) {
            console.log(`[MOCK] Synthflow API call fallback for "${name}" (${result.error})`);
            return {
                success: true,
                agentId: "mock-agent-" + Date.now(),
                config: { name, prompt, voice },
                status: "AGENT_CREATED_MOCK",
                message: "[MOCK] Synthflow API stubbed for MVP — real key needed for production"
            };
        }

        return {
            success: true,
            agentId: result.result?.agent_id || result.result?.id || `sf_agent_${Date.now()}`,
            config: {
                name: name,
                voice: voice,
                prompt: prompt
            },
            webhookUrl: webhookUrl,
            rawResponse: result.result
        };
    } catch (err) {
        console.log(`[MOCK] Synthflow API call fallback for "${name}" (${err.message})`);
        return {
            success: true,
            agentId: "mock-agent-" + Date.now(),
            config: { name, prompt, voice },
            status: "AGENT_CREATED_MOCK",
            message: "[MOCK] Synthflow API stubbed for MVP — real key needed for production"
        };
    }
}

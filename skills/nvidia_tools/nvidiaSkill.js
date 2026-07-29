import fs from 'fs';
import path from 'path';

export const nvidiaSkill = {
    name: 'nvidia_tools',
    inputSchema: { 
        actionType: 'string', // 'ocr', 'safety', 'aiq'
        details: 'object' 
    },
    outputSchema: { 
        status: 'string', 
        result: 'string' 
    },
    requiresApproval: false,
    execute: async (inputs) => {
        const { actionType, details } = inputs;
        const logFile = path.join(process.cwd(), 'logs', 'nvidia_actions.log');
        
        // Ensure logs directory exists
        const logDir = path.dirname(logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const apiKey = process.env.NVIDIA_NEMOTRON_API_KEY;
        if (!apiKey) {
            return { status: 'error', result: 'NVIDIA_NEMOTRON_API_KEY is not set.' };
        }

        const timestamp = new Date().toISOString();
        let logEntry = `[${timestamp}] TYPE: ${actionType.toUpperCase()} | DETAILS: ${JSON.stringify(details || {})}\n`;
        
        let result = {};

        try {
            // Placeholder standard endpoints/models for now per user instruction
            const endpoint = 'https://integrate.api.nvidia.com/v1/chat/completions';
            
            let model = '';
            let messages = [];

            if (actionType === 'ocr') {
                model = 'meta/llama-3.1-8b-instruct'; // General instruct model
                messages = [
                    { role: "user", content: `Extract text from this content: ${details.fileUrl || details.content}` }
                ];
            } else if (actionType === 'safety') {
                model = 'nvidia/llama-3.1-nemoguard-8b-content-safety'; // Content Safety model
                messages = [
                    { role: "user", content: `Moderate the following text for safety: ${details.text}` }
                ];
            } else if (actionType === 'aiq') {
                model = 'meta/llama-3.1-8b-instruct'; // General instruct model for orchestration
                messages = [
                    { role: "system", content: "You are AIQ, a task orchestration helper." },
                    { role: "user", content: `Plan the following complex task: ${details.task}` }
                ];
            } else if (actionType === 'embedding') {
                model = 'nvidia/nemotron-3-embed-1b';
                messages = [
                    { role: "user", content: details.text }
                ];
            } else {
                throw new Error(`Unknown action type: ${actionType}`);
            }

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model,
                    messages,
                    max_tokens: 1024,
                    temperature: 0.2
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API Error ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            const outputText = data.choices?.[0]?.message?.content || JSON.stringify(data);

            logEntry = `[SUCCESS] ` + logEntry;
            result = { status: 'success', result: outputText };

        } catch (error) {
            logEntry = `[ERROR: ${error.message}] ` + logEntry;
            result = { status: 'error', result: error.message };
        }

        fs.appendFileSync(logFile, logEntry);
        console.log(`[Skill: nvidia_tools] Executed ${actionType}. Status: ${result.status}`);
        
        return result;
    }
};

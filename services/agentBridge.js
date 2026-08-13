import { callLLM } from '../llmRouter.js';
import pkg from 'pg';

// Agent-to-Agent Bridge Subsystem
// Handles standardized JSON communication with external agentic systems.

/**
 * Standardized Agent Message Protocol
 * @typedef {Object} AgentMessage
 * @property {string} id - Unique message ID
 * @property {string} sender - Sending agent identifier
 * @property {string} target - Target agent identifier
 * @property {string} intent - Purpose of the message
 * @property {Object} payload - JSON data payload
 * @property {number} timestamp - Unix epoch ms
 */

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export class AgentBridge {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * Sends a message to another agent (e.g., Claude, Prime Agent) with exponential backoff
     * @param {AgentMessage} message 
     * @returns {Promise<any>}
     */
    async sendMessage(message) {
        let attempt = 0;
        let lastError = null;

        while (attempt < MAX_RETRIES) {
            try {
                // In this implementation, we route external agent queries through the llmRouter
                // if target is a known LLM, or via custom HTTP endpoints for local agents.
                
                const systemPrompt = "You are an autonomous agent receiving a structured JSON request from Ghost AI. Respond strictly in JSON matching the requested schema.";
                const prompt = JSON.stringify(message, null, 2);

                const responseRaw = await callLLM([{ role: 'user', content: prompt }], {
                    systemPrompt,
                    maxTokens: 2000,
                    // If target is Claude, we'd normally route directly, but here we let the llmRouter handle it
                });

                // Try parsing the JSON response
                let parsedResponse;
                try {
                    parsedResponse = JSON.parse(responseRaw);
                } catch (parseErr) {
                    // Fallback to extract from markdown if necessary
                    const match = responseRaw.match(/```json\n([\s\S]*?)\n```/);
                    if (match) {
                        parsedResponse = JSON.parse(match[1]);
                    } else {
                        throw new Error("Target agent did not return valid JSON.");
                    }
                }

                // Log interaction
                this.logInteraction(message, parsedResponse, 'success');
                return parsedResponse;

            } catch (err) {
                lastError = err;
                attempt++;
                console.warn(`[AgentBridge] Attempt ${attempt} failed: ${err.message}. Retrying...`);
                if (attempt < MAX_RETRIES) {
                    await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt)); // Exponential backoff
                }
            }
        }

        this.logInteraction(message, { error: lastError.message }, 'failed');
        throw new Error(`[AgentBridge] Failed to send message after ${MAX_RETRIES} attempts: ${lastError.message}`);
    }

    async logInteraction(request, response, status) {
        if (!this.pool) return;
        try {
            await this.pool.query(
                'INSERT INTO agent_interactions (request_payload, response_payload, status, created_at) VALUES ($1, $2, $3, NOW())',
                [JSON.stringify(request), JSON.stringify(response), status]
            );
        } catch (e) {
            console.error('[AgentBridge] Failed to log interaction:', e.message);
        }
    }
}

export function initAgentBridge(pool) {
    console.log('[AgentBridge] Initializing Agent-to-Agent integration...');
    return new AgentBridge(pool);
}

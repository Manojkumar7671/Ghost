import express from 'express';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 4-Tier Optimized Gateway Matrix
const PROVIDER_MATRIX = [
    {
        name: 'Groq (Primary Fast-Layer)',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'llama-3.3-70b-versatile',
        apiKey: process.env.GROQ_API_KEY
    },
    {
        name: 'Gemini (Secondary Reasoning-Layer)',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        model: 'gemini-1.5-flash',
        apiKey: process.env.GEMINI_API_KEY
    },
    {
        name: 'Nvidia NIM (High-Throughput Fallback)',
        endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
        model: 'meta/llama-3.1-405b-instruct',
        apiKey: process.env.NVIDIA_API_KEY
    },
    {
        name: 'Nex-N2-Pro (Zero-Cost Fail-Safe)',
        endpoint: 'https://api.openrouter.ai/v1/chat/completions',
        model: 'nex-n2-pro-free', // OpenRouter free-tier backup
        apiKey: process.env.OPENROUTER_API_KEY
    }
];

/**
 * Executes a resilient LLM call down the Gateway Matrix.
 * Automatically drops slow providers after 4 seconds to eliminate network latency.
 */
async function callLLM(messages, maxTokens = 2000) {
    for (const provider of PROVIDER_MATRIX) {
        if (!provider.apiKey) {
            console.warn(`[Gateway Skip]: ${provider.name} skipped due to missing API Key.`);
            continue;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000); // 4-Second Cutoff

        try {
            console.log(`[Gateway Attempting]: Routing request to ${provider.name}...`);
            
            const response = await fetch(provider.endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${provider.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: provider.model,
                    messages: messages,
                    temperature: 0.2,
                    max_tokens: maxTokens
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`HTTP ${response.status}: ${JSON.stringify(errorData.error || errorData)}`);
            }

            const data = await response.json();
            console.log(`[Gateway Success]: Answer generated successfully via ${provider.name}`);
            return data.choices[0].message.content;

        } catch (error) {
            clearTimeout(timeoutId);
            const isTimeout = error.name === 'AbortError';
            console.error(`[Gateway Failover]: ${provider.name} dropped. Reason: ${isTimeout ? '4s Execution Timeout' : error.message}`);
            // Explicitly loops to the next iteration to try the subsequent provider
        }
    }

    throw new Error("Critical Gateway Exception: Every single engine in the LLM matrix timed out or failed.");
}

/**
 * Telegram Webhook Handler
 */
app.post('/webhook/telegram', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || !message.text) {
            return res.sendStatus(200); // Early exit for non-text events
        }

        const chatId = message.chat.id;
        const incomingText = message.text;

        console.log(`[Incoming Message] Chat ID: ${chatId} | Prompt: "${incomingText}"`);

        // 1. Pull dynamic contextual instructions from Supabase instead of self-modifying code files
        const { data: instructionRow } = await supabase
            .from('core_directives')
            .select('directives_list')
            .single();

        const baseSystemDirective = instructionRow?.directives_list || "You are Ghost, a highly efficient automated agent.";

        // 2. Format Payload for LLM Processing
        const conversationPayload = [
            { role: 'system', content: baseSystemDirective },
            { role: 'user', content: incomingText }
        ];

        // 3. Process Prompt Via Gateway Matrix
        const agentOutput = await callLLM(conversationPayload, 2500);

        // 4. Dispatch Response Back to Telegram
        const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
        await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: agentOutput
            })
        });

        return res.status(200).json({ status: 'success' });

    } catch (globalError) {
        console.error('[System Error Encountered]:', globalError.message);
        return res.status(500).json({ error: 'Internal pipeline execution failure.' });
    }
});

// Live Server Binding
app.listen(PORT, () => {
    console.log(`Ghost Server running securely on port ${PORT}`);
});
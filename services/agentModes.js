import cron from 'node-cron';
import path from 'path';
import { safeFetch } from './urlSafety.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const llm = require('../src/tools/llm.js');
const chat = llm.chat;

const memory = require('../src/tools/memory.js');
const { saveMessage } = memory;

const webAgent = require('../src/agents/webAgent.js');
const voiceAgent = require('../src/agents/voiceAgent.js');

const activeJobs = new Map();

export async function initAgentModes(pool) {
    if (!pool) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS monitor_state (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255) NOT NULL,
                target VARCHAR(255) NOT NULL,
                condition VARCHAR(255) NOT NULL,
                last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_result TEXT,
                UNIQUE(user_id, target)
            )
        `);
        console.log('[Agent Modes] monitor_state table verified/created.');
    } catch (err) {
        console.error('[Agent Modes] Error creating monitor_state table:', err.message);
    }
}

export function activateMorningDigest(cronExpr, username, pool) {
    const jobKey = `morning_digest:${username}`;
    if (activeJobs.has(jobKey)) {
        activeJobs.get(jobKey).stop();
    }

    const job = cron.schedule(cronExpr, async () => {
        console.log(`[Agent Modes] Running Morning Digest for ${username}`);
        try {
            const newsResult = await webAgent.searchWeb('latest tech and AI news');
            const newsSummary = newsResult.summary || 'No new news today.';

            const prompt = `Create a short, spoken-style morning briefing for Manoj. 
Include:
- A warm morning greeting.
- An email summary: "You have 2 unread emails regarding project updates."
- A calendar summary: "Today you have: Team Sync at 10 AM, and Code Review at 2 PM."
- Today's top tech news: ${newsSummary}

Keep the briefing short, direct, conversational, and under 150 words (suitable for speaking). Do not use markdown format tags.`;

            const briefing = await chat([{ role: 'user', content: prompt }], {
                systemPrompt: "You are Ghost, Manoj's loyal AI assistant. Output only the spoken briefing text."
            });

            let voiceMessage = '';
            if (process.env.ELEVENLABS_API_KEY) {
                try {
                    const ttsRes = await voiceAgent.textToSpeech(briefing, `morning_digest_${Date.now()}.mp3`);
                    if (ttsRes.success) {
                        voiceMessage = ` [Voice briefing generated: logs/audio/${path.basename(ttsRes.file)}]`;
                    }
                } catch (e) {
                    console.error('[Agent Modes] TTS generation failed:', e.message);
                }
            }

            saveMessage(username, 'assistant', briefing + voiceMessage);
            console.log(`[Agent Modes] Morning Digest sent to ${username}`);
        } catch (err) {
            console.error('[Agent Modes] Morning Digest execution failed:', err.message);
        }
    });

    activeJobs.set(jobKey, job);
    return { success: true, cron: cronExpr };
}

export function activateScheduledMonitor(cronExpr, target, condition, username, pool) {
    const jobKey = `monitor:${username}:${target}`;
    if (activeJobs.has(jobKey)) {
        activeJobs.get(jobKey).stop();
    }

    const job = cron.schedule(cronExpr, async () => {
        console.log(`[Agent Modes] Running Monitor for ${username} on target: ${target}`);
        try {
            let resultText = '';

            if (target.startsWith('http://') || target.startsWith('https:')) {
                const res = await safeFetch(target);
                resultText = await res.text();
            } else {
                const searchRes = await webAgent.searchWeb(target);
                resultText = searchRes.summary || JSON.stringify(searchRes);
            }

            const prompt = `Content from target "${target}":
"""
${resultText.slice(0, 1000)}
"""

Condition to check: "${condition}"

Does the content meet or trigger the condition? Respond with a JSON object:
{
  "triggered": true,
  "explanation": "Brief explanation of the status/metric found"
}
`;
            const checkRes = await chat([{ role: 'user', content: prompt }], {
                systemPrompt: "You are Ghost's monitoring analyzer. Respond only with valid raw JSON."
            });

            let analysis = { triggered: false, explanation: 'Failed to parse check' };
            try {
                const cleaned = checkRes.replace(/```(?:json)?/g, '').trim();
                analysis = JSON.parse(cleaned);
            } catch (e) {
                const objMatch = checkRes.match(/\{[\s\S]*\}/);
                if (objMatch) analysis = JSON.parse(objMatch[0]);
            }

            if (pool) {
                await pool.query(
                    `INSERT INTO monitor_state (user_id, target, condition, last_result) 
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (user_id, target) 
                     DO UPDATE SET last_result = $4, last_checked = CURRENT_TIMESTAMP`,
                    [username, target, condition, analysis.explanation]
                );
            }

            if (analysis.triggered) {
                const message = `[ALERT] Monitor condition triggered for target "${target}"!\nCondition: "${condition}"\nExplanation: ${analysis.explanation}`;
                saveMessage(username, 'assistant', message);
                console.log(`[Agent Modes] Monitor ALERT sent to ${username}`);
            }
        } catch (err) {
            console.error('[Agent Modes] Monitor failed:', err.message);
        }
    });

    activeJobs.set(jobKey, job);
    return { success: true, cron: cronExpr };
}

export function listActiveJobs() {
    return Array.from(activeJobs.keys());
}

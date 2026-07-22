import cron from 'node-cron';
import path from 'path';
import { safeFetch } from './urlSafety.js';
import { createRequire } from 'module';
import { runAutonomous } from './autonomousLoop.js';

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

export async function deepResearch(query, userContext = {}, pool = null) {
  const username = userContext.safeUser || 'guest';
  let currentQuery = query;
  let aggregatedData = [];
  let visitedQueries = new Set();
  let iteration = 1;
  const maxIterations = 8;

  console.log(`[Deep Research] Starting deep research for query: "${query}"`);
  saveMessage(username, 'assistant', `[Deep Research] Initiating deep research on: "${query}"...`);

  while (iteration <= maxIterations) {
    if (visitedQueries.has(currentQuery.toLowerCase())) {
      console.log(`[Deep Research] Query "${currentQuery}" already searched. Ending research.`);
      break;
    }
    visitedQueries.add(currentQuery.toLowerCase());

    console.log(`[Deep Research] Iteration ${iteration}: Searching for "${currentQuery}"`);
    saveMessage(username, 'assistant', `[Deep Research] Searching angle ${iteration}: "${currentQuery}"...`);

    let searchResult;
    try {
      searchResult = await webAgent.searchWeb(currentQuery);
    } catch (e) {
      searchResult = { summary: `Error: ${e.message}` };
    }

    const summary = searchResult.summary || JSON.stringify(searchResult);
    aggregatedData.push({ query: currentQuery, summary });

    const prompt = `We are performing exhaustive research on the topic: "${query}".
So far we have gathered:
${aggregatedData.map((d, i) => `Angle ${i+1} (${d.query}): ${d.summary.slice(0, 400)}`).join('\n')}

Based on the goal and current findings, is there any remaining gap, missing details, or unresolved angle that we must search for to make this research complete?

Respond ONLY with a valid raw JSON object (no markdown, no other text):
{
  "hasNewInfo": true or false,
  "newQuery": "The next search query to resolve the identified gap (empty if none)",
  "explanation": "Brief explanation of what gap is resolved by this new query"
}`;

    const checkRes = await chat([{ role: 'user', content: prompt }], {
      systemPrompt: "You are Ghost's deep research planner. Respond only with valid raw JSON.",
      model: 'google/gemini-2.5-flash'
    });

    let plan = { hasNewInfo: false, newQuery: '' };
    try {
      const cleaned = checkRes.replace(/```(?:json)?/g, '').trim();
      plan = JSON.parse(cleaned);
    } catch (e) {
      const objMatch = checkRes.match(/\{[\s\S]*\}/);
      if (objMatch) plan = JSON.parse(objMatch[0]);
    }

    if (!plan.hasNewInfo || !plan.newQuery) {
      console.log(`[Deep Research] No new angles identified. Synthesis starting.`);
      break;
    }

    currentQuery = plan.newQuery;
    iteration++;
  }

  saveMessage(username, 'assistant', `[Deep Research] Research angles completed. Synthesizing all findings...`);

  // Synthesis
  const synthesisPrompt = `Synthesize all the research findings collected for the query: "${query}".
Findings gathered:
${aggregatedData.map((d, i) => `Angle ${i+1} (${d.query}):\n${d.summary}`).join('\n\n')}

Write a highly detailed, comprehensive research report that covers all these aspects thoroughly. Use markdown formatting.`;

  const finalReport = await chat([{ role: 'user', content: synthesisPrompt }], {
    systemPrompt: "You are Ghost, Manoj's loyal AI researcher. Write a comprehensive research report.",
    model: 'google/gemini-2.5-flash'
  });

  saveMessage(username, 'assistant', finalReport);
  return finalReport;
}

export async function buildTask(goal, userContext = {}, pool = null) {
  const username = userContext.safeUser || 'guest';
  saveMessage(username, 'assistant', `[Build Task] Initiating build task autonomous execution for goal: "${goal}"...`);
  const result = await runAutonomous(goal, userContext, pool);
  
  let finalMsg;
  if (result.status === 'fixed') {
    finalMsg = `[Build Task] Success! Goal accomplished: "${goal}"\n\nResult:\n${result.message}`;
  } else {
    finalMsg = `[Build Task] Failed or requires feedback: "${goal}"\n\nReason:\n${result.reason}`;
  }
  
  saveMessage(username, 'assistant', finalMsg);
  return result;
}

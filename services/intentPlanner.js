import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const llm = require('../src/tools/llm.js');
const chat = llm.chat;

export function classifyComplexity(userMessage) {
    if (!userMessage || typeof userMessage !== 'string') return 'simple';
    const msg = userMessage.toLowerCase().trim();

    // Coordinating conjunctions or sequencing terms indicate multi-step intents
    const complexSequences = [
        ' and ', ' then ', ' after ', ' before ', ' next ', ' also ', ' then write ', 
        ' later ', ' followed by ', ' in addition to ', ' first '
    ];
    if (complexSequences.some(seq => msg.includes(seq))) {
        return 'complex';
    }

    // High length indicates complexity
    if (userMessage.length > 150) {
        return 'complex';
    }

    // Multi-action indicator words
    const complexWords = [
        'research', 'deep dive', 'deep_research', 'analyze', 
        'summarize and', 'compare', 'monitor', 'find and email',
        'scrape and', 'search for', 'email', 'someone'
    ];
    if (complexWords.some(word => msg.includes(word)) && msg.split(' ').length > 4) {
        return 'complex';
    }

    return 'simple';
}

export async function analyzeIntent(userMessage, conversationContext) {
    const systemPrompt = `You are the Intent Analyzer for Ghost. Analyze the user's message and the conversation context to understand their goal, identify any ambiguities, highlight constraints, and infer the implied steps required to accomplish the goal.

CRITICAL PRONOUN / REFERENCE RESOLUTION RULE:
If the user message contains pronouns or references like "it", "that file", "the app", "open it", "play it", etc., you MUST examine the Conversation Context below to identify the last-mentioned file, application, URL, or entity and resolve the pronoun to that exact entity in the generated "goal" and "impliedSteps". Do not use literal pronouns in the goal or steps if the entity is identifiable from context.

You must respond with a raw JSON object matching this schema (do not include markdown formatting or extra text outside the JSON):
{
  "goal": "The ultimate goal the user wants to achieve",
  "ambiguities": ["List of unresolved blocking ambiguities or missing critical inputs needed to proceed. Keep empty if there are no blocking ambiguities. Only include blocking ambiguities here that prevent starting the plan."],
  "constraints": ["List of user-specified or implied constraints"],
  "impliedSteps": ["High-level logical steps required to accomplish the goal"]
}

Conversation Context:
${JSON.stringify(conversationContext || {})}
`;

    const startTime = Date.now();
    const response = await chat(
        [{ role: 'user', content: userMessage }],
        { systemPrompt, maxTokens: 512, model: 'google/gemini-2.5-flash' }
    );
    const latency = Date.now() - startTime;
    console.log(`[Intent Planner Timing] analyzeIntent completed in ${latency}ms`);

    console.log('[Intent Planner Debug] Raw response from chat:', response);
    const parsed = extractJsonFromResponse(response);
    console.log('[Intent Planner Debug] Parsed response:', parsed);
    return parsed;
}

export async function buildTaskPlan(intent) {
    const systemPrompt = `You are the Task Planner for Ghost. Generate a dependency-oriented task plan (DAG) in JSON format.

Goal: "${intent.goal}"
Implied Steps: ${JSON.stringify(intent.impliedSteps)}
Constraints: ${JSON.stringify(intent.constraints)}

Format your response strictly as a JSON array of objects. Do not write any markdown, explanation, code block, or text.

Each task must have:
- "id": (string, e.g. "step1")
- "description": (string description of the action)
- "requiredCapability": (exactly one of "web_search", "browser_automation", "email", "db_query", "code_exec", "workspace_edit", "workspace_view")
- "dependsOn": (array of previous step IDs)

Ensure the output is valid JSON. Keep it simple and short.`;

    const startTime = Date.now();
    const response = await chat(
        [{ role: 'user', content: "Generate the task plan JSON array now." }],
        { systemPrompt, maxTokens: 512, model: 'google/gemini-2.5-flash' }
    );
    const latency = Date.now() - startTime;
    console.log(`[Intent Planner Timing] buildTaskPlan completed in ${latency}ms`);

    return extractJsonFromResponse(response);
}

function extractJsonFromResponse(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let cleaned = raw
        .replace(/:\s*(code_exec|web_search|browser_automation|email|db_query|workspace_edit|workspace_view)(?=\s*[,}\n])/g, ': "$1"')
        .replace(/```(?:json)?/g, '')
        .trim();
    try {
        return JSON.parse(cleaned);
    } catch {}
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) {
        try {
            return JSON.parse(objectMatch[0]);
        } catch {}
    }
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
        try {
            return JSON.parse(arrayMatch[0]);
        } catch {}
    }
    throw new Error("Failed to parse JSON from LLM: " + raw);
}

export async function generateToolParams(toolName, stepDescription, previousResults, originalMessage) {
    let instructionsPrompt = '';
    if (toolName === 'database_query') {
        try {
            const skillPath = path.join(__dirname, '../skills/db_query/SKILL.md');
            if (fs.existsSync(skillPath)) {
                const skillContent = fs.readFileSync(skillPath, 'utf8');
                const match = skillContent.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
                const body = match ? match[1].trim() : skillContent.trim();
                instructionsPrompt = `\n\nUSE THESE GUIDELINES FOR GENERATING SQL:\n${body}`;
            }
        } catch (e) {
            console.error('[IntentPlanner] Error loading db_query instructions:', e.message);
        }
    } else if (toolName === 'browser_automation') {
        try {
            const browserbaseClient = (await import('./browserbaseClient.js')).default;
            instructionsPrompt = `\n\nUSE THESE GUIDELINES FOR browser_automation:\n${browserbaseClient.getPromptString()}`;
        } catch (e) {
            console.error('[IntentPlanner] Error loading browser_automation instructions:', e.message);
        }
    }

    const systemPrompt = `You are Ghost's Tool Parameter Generator. Generate the exact JSON parameters for the tool "${toolName}" to perform this step: "${stepDescription}".

Original Goal: "${originalMessage}"
Previous Steps and Results:
${previousResults.map((r, i) => `- Step: ${r.description}\n  Result: ${String(r.output).slice(0, 500)}`).join('\n')}

Respond ONLY with a valid raw JSON object representing the parameters for this tool. Follow the schema/naming of typical tool arguments (e.g. for web_search: { "query": "..." }, for database_query: { "sql": "..." }, for workspace_edit_file: { "path": "...", "targetContent": "...", "replacementContent": "..." }).

CRITICAL: If the tool is "workspace_edit_file", note that the previous step's file view result includes line numbers like "1: code", "2: code". These line numbers are NOT in the actual file! You MUST strip "1: ", "2: " prefixes from the code when writing the "targetContent" and "replacementContent" parameters!${instructionsPrompt}`;

    const startTime = Date.now();
    const res = await chat(
        [{ role: 'user', content: `Generate params for ${toolName}` }],
        { systemPrompt, maxTokens: 256, model: 'google/gemini-2.5-flash' }
    );
    const latency = Date.now() - startTime;
    console.log(`[Intent Planner Timing] generateToolParams for "${toolName}" completed in ${latency}ms`);
    try {
        const cleaned = res.replace(/```(?:json)?/g, '').trim();
        return JSON.parse(cleaned);
    } catch {
        const match = res.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        return {};
    }
}

export async function verifyGoalSatisfaction(originalMessage, plan, previousResults) {
    const verifyPrompt = `Verify if the accumulated results satisfy the original user goal.
Original Goal: "${originalMessage}"
Task Plan and Results:
${previousResults.map((r, i) => `- Step: ${r.description}\n  Tool: ${r.tool}\n  Result: ${String(r.output).slice(0, 500)}`).join('\n')}

Verify if the goal has been fully met. Respond with a JSON object matching this schema:
{
  "satisfied": true,
  "failedStepId": "If unsatisfied, specify the step ID (e.g. step1, step2) that failed. Keep null if satisfied.",
  "reason": "Brief explanation of why it is satisfied or what is missing"
}
`;

    const startTime = Date.now();
    const res = await chat([{ role: 'user', content: 'Verify results' }], { systemPrompt: verifyPrompt, maxTokens: 256 });
    const latency = Date.now() - startTime;
    console.log(`[Intent Planner Timing] verifyGoalSatisfaction completed in ${latency}ms`);
    try {
        const cleaned = res.replace(/```(?:json)?/g, '').trim();
        return JSON.parse(cleaned);
    } catch {
        const match = res.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        return { satisfied: true, failedStepId: null, reason: 'Failed to parse verification' };
    }
}

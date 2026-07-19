import path from 'path';
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
        'scrape and', 'search for'
    ];
    if (complexWords.some(word => msg.includes(word)) && msg.split(' ').length > 4) {
        return 'complex';
    }

    return 'simple';
}

export async function analyzeIntent(userMessage, conversationContext) {
    const systemPrompt = `You are the Intent Analyzer for Ghost. Analyze the user's message and the conversation context to understand their goal, identify any ambiguities, highlight constraints, and infer the implied steps required to accomplish the goal.

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

    const response = await chat(
        [{ role: 'user', content: userMessage }],
        { systemPrompt, maxTokens: 512 }
    );

    console.log('[Intent Planner Debug] Raw response from chat:', response);
    const parsed = extractJsonFromResponse(response);
    console.log('[Intent Planner Debug] Parsed response:', parsed);
    return parsed;
}

export async function buildTaskPlan(intent) {
    const systemPrompt = `You are the Task Planner for Ghost. Generate a dependency-oriented task plan (DAG) to execute the following goal.

Goal: ${intent.goal}
Implied Steps: ${intent.impliedSteps.join(', ')}
Constraints: ${intent.constraints.join(', ')}

Respond ONLY with a raw JSON array of task objects (do not include markdown formatting or extra text outside the JSON). Each task object must have:
- "id": A unique string ID (e.g. "step1", "step2")
- "description": Clear, action-oriented description of what this step does
- "requiredCapability": Must be exactly one of: "web_search", "browser_automation", "email", "db_query", "code_exec"
- "dependsOn": Array of other step IDs that MUST finish before this step can start (empty array if no dependencies)

Example:
[
  { "id": "step1", "description": "Search the web for news about LLMs", "requiredCapability": "web_search", "dependsOn": [] },
  { "id": "step2", "description": "Summarize the findings and email to Manoj", "requiredCapability": "email", "dependsOn": ["step1"] }
]
`;

    const response = await chat(
        [{ role: 'user', content: `Goal: ${intent.goal}` }],
        { systemPrompt, maxTokens: 512 }
    );

    return extractJsonFromResponse(response);
}

function extractJsonFromResponse(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try {
        const cleaned = raw.replace(/```(?:json)?/g, '').trim();
        return JSON.parse(cleaned);
    } catch {}
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (objectMatch) {
        try {
            return JSON.parse(objectMatch[0]);
        } catch {}
    }
    const arrayMatch = raw.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
        try {
            return JSON.parse(arrayMatch[0]);
        } catch {}
    }
    throw new Error("Failed to parse JSON from LLM: " + raw);
}

export async function generateToolParams(toolName, stepDescription, previousResults, originalMessage) {
    const systemPrompt = `You are Ghost's Tool Parameter Generator. Generate the exact JSON parameters for the tool "${toolName}" to perform the following step: "${stepDescription}".

Original Goal: "${originalMessage}"
Previous Steps and Results:
${previousResults.map((r, i) => `- Step: ${r.description}\n  Result: ${String(r.output).slice(0, 500)}`).join('\n')}

Respond ONLY with a valid raw JSON object representing the parameters for this tool. Follow the schema/naming of typical tool arguments (e.g. for web_search: { "query": "..." }, for email_send: { "to": "...", "subject": "...", "context": "..." }, for database_query: { "sql": "..." }, for workspace_edit_file: { "path": "...", "content": "..." }). No preamble, no explanation.`;

    const res = await chat([{ role: 'user', content: `Generate params for ${toolName}` }], { systemPrompt, maxTokens: 256 });
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

    const res = await chat([{ role: 'user', content: 'Verify results' }], { systemPrompt: verifyPrompt, maxTokens: 256 });
    try {
        const cleaned = res.replace(/```(?:json)?/g, '').trim();
        return JSON.parse(cleaned);
    } catch {
        const match = res.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        return { satisfied: true, failedStepId: null, reason: 'Failed to parse verification' };
    }
}

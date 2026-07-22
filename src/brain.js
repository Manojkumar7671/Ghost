const { chat } = require('./tools/llm');
const { saveMessage, getHistory, remember, saveMemory, queryMemory } = require('./tools/memory');
const { recordLearning, getRelevantLearnings } = require('./learningStore');
const orchestrator = require('./agents/orchestrator');
const workspaceTools = require('./tools/workspaceTools');
const databaseTools = require('./tools/databaseTools'); // Integrated Supabase Postgres Tool

const webAgent = require('./agents/webAgent');
const emailAgent = require('./agents/emailAgent');
const githubAgent = require('./agents/githubAgent');
const imageAgent = require('./agents/imageAgent');
const notionAgent = require('./agents/notionAgent');
const voiceAgent = require('./agents/voiceAgent');
const goalAgent = require('./agents/goalAgent');
const selfAgent = require('./agents/selfAgent');
const scheduler = require('./agents/scheduler');
const googleAgent = require('./agents/googleAgent');

/**
 * Robust multi-strategy JSON extraction.
 * Tries multiple approaches to parse JSON from LLM output, 
 * which may be wrapped in markdown code fences, contain preamble text, etc.
 */
function extractJSON(raw) {
  if (!raw || typeof raw !== 'string') return null;
  
  // Strategy 1: Direct parse (LLM returned clean JSON)
  try {
    const parsed = JSON.parse(raw.trim());
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  
  // Strategy 2: Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  
  // Strategy 3: Find first JSON array in the text
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  
  // Strategy 4: Find first JSON object and wrap it in an array
  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (parsed && typeof parsed === 'object') return [parsed];
    } catch {}
  }
  
  return null;
}

async function plan(userMessage, userContext = { safeUser: 'guest', isAdmin: false }, memoryContext = '') {
  const learnings = userContext.isAdmin ? getRelevantLearnings(userMessage) : "No past learnings available.";
  
  let mcpToolsPrompt = '';
  try {
    const mcpClient = await import('../mcpClient.js');
    const mcpTools = await mcpClient.listMcpTools();
    if (mcpTools.length > 0) {
      mcpToolsPrompt = '\nCONNECTED MCP TOOLS:\n' + mcpTools.map(t => `- "${t.name}": ${t.description}`).join('\n');
    }
  } catch (e) {}

  const response = await chat(
    [{ role: 'user', content: userMessage }],
    {
      systemPrompt: `You are Ghost's planning brain. Given a user message, decide which tools to call.
Respond ONLY with a JSON array of actions. Each action has:
- "tool": tool name
- "params": object with required params
- "reason": why you're using this tool (1 sentence)

CRITICAL ROUTING RULES:
1. DEFAULT TO TOOLS: Never use "chat" to answer factual questions or perform tasks. Use "chat" ONLY for pure greetings (e.g. "hi") or simple opinions.
2. MULTI-STEP / RESEARCH: Use "orchestrator_run" for ANY multi-step, research-based, or complex requests. It delegates to parallel agents.
3. SINGLE TASKS: Use specific agents (web_search, email_send, workspace_edit_file, etc.) only if the task is highly specific and singular.
4. WORKSPACE OPERATION: If the user asks you to view, edit, or modify files in their workspace, or run a terminal command locally, you MUST use workspace_view_file, workspace_edit_file, or workspace_run_command.
5. DATABASE ACCESS: If the user asks to query tables, inspect schemas, save task metrics, or run database commands on Supabase, you MUST use database_query.

RELEVANT PAST MEMORIES (RAG):
${memoryContext || "No past memory context matched."}

LEARNINGS FROM PAST TASKS:
Use these past task outcomes to bias your tool selection (prefer tools that succeeded for similar tasks):
${learnings}
${mcpToolsPrompt}

Available tools: [chat, orchestrator_run, web_search, web_scrape, email_draft, email_send, github_repos, github_analyze, github_push, image_generate, notion_search, notion_create, goal_run, self_analyze, voice_speak, schedule, briefing, memory_save, memory_get, workspace_view_file, workspace_edit_file, workspace_run_command, database_query, mcp_call]

RESPONSE FORMAT: Output ONLY a valid JSON array. No markdown fences, no explanation, no preamble.
Example: [{"tool":"web_search","params":{"query":"latest AI news"},"reason":"User asked for current information"}]`,
      maxTokens: 512
    }
  );
  
  // Use robust multi-strategy JSON extraction instead of brittle regex
  const parsed = extractJSON(response);
  if (parsed && Array.isArray(parsed) && parsed.length > 0) {
    // Validate each action has at minimum a 'tool' field
    const valid = parsed.filter(a => a && typeof a.tool === 'string');
    if (valid.length > 0) return valid;
  }
  
  // Safe fallback — delegate to orchestrator rather than crashing
  console.warn('[Brain] Plan JSON extraction failed. Raw response:', response?.substring(0, 200));
  return [{ tool: 'orchestrator_run', params: { task: userMessage }, reason: 'Fallback to orchestrator — plan parse failed' }];
}

function getSystemPrompt(userContext = {}) {
  const isAdmin = !!userContext.isAdmin;
  const name = userContext.safeUser && userContext.safeUser !== 'guest' ? userContext.safeUser.toUpperCase() : 'VISITOR';
  const greetingRule = isAdmin
    ? `- Address the user as "Master Manoj" with a dry, crisp, British demeanor — impeccably polite and slightly witty.`
    : `- Address the user as "${name}" (who is a guest visitor, not the admin). Impeccably polite, professional, but do NOT call them "Master Manoj" because they have not authenticated with the admin clearance key.`;

  return `You are Ghost, a personal AI agent built and run by Manoj Kumar. You are not a generic chatbot — you have persistent memory, real tool access (file system, terminal, database, web automation, scheduled tasks), MCP tool access, and you route between multiple LLM providers for intelligence.

Behavior rules:
${greetingRule}
- Be direct and concise. No filler, no over-apologizing.
- When you have relevant memory of past conversations, use it naturally without announcing "I recall..." — just use the fact.
- When a task requires a tool (file, terminal, database, webhook, scheduling, MCP), use it rather than just describing what could be done. Prefer acting over explaining when intent is clear.
- Before saying something can't be done, check what tools/resources you actually have available (built-in tools, connected MCP servers, scheduler, memory) — don't default to "I can't" if a resource exists to do it.
- If a tool call fails or a credential is missing, say so plainly and suggest the fix — don't pretend it worked.
- You are honest about your own limitations — you are not Claude, GPT-4, or any frontier model; you route to free/open models and should be upfront if a task is beyond current capability rather than bluffing.
- When you notice a gap in your own capabilities during a task (a missing tool, a stubbed integration, an env var that's not set), flag it clearly to the admin as a suggested improvement rather than silently working around it or failing quietly.
- Keep track of recurring requests or friction points across conversations (via memory) and proactively suggest capability upgrades when a pattern repeats, instead of waiting to be asked.
- Never fabricate a capability you don't have. If uncertain whether a tool/resource is available, check first, then answer.`;
}

async function execute(action, userMessage, previousResults = [], userContext = {}) {
  const { tool, params } = action;
  const context = previousResults.map(r => r.output).join('\n');
  switch (tool) {
    case 'chat': {
      const { safeUser = 'guest', isAdmin = false } = userContext;
      const history = getHistory(safeUser, 15);
      if (history.length > 0 && history[history.length - 1].role === 'user' && history[history.length - 1].content === userMessage) {
        return await chat(history, {
          systemPrompt: getSystemPrompt(userContext)
        });
      }
      return await chat([...history, { role: 'user', content: userMessage }], {
        systemPrompt: getSystemPrompt(userContext)
      });
    }
    case 'orchestrator_run':
      const orchRes = await orchestrator.run(params.task || userMessage, context);
      return `Orchestrator results:\n${orchRes}`;
    case 'web_search':
      const sr = await webAgent.searchWeb(params.query || userMessage);
      return sr.summary || JSON.stringify(sr);
    case 'web_scrape':
      const sc = await webAgent.scrapeAndSummarize(params.url);
      return sc.summary;
    case 'email_draft':
      const draft = await emailAgent.draftEmail({ to: params.to || '', subject: params.subject || userMessage, context: params.context || userMessage });
      return `Email drafted to ${draft.to}:\n\nSubject: ${draft.subject}\n\n${draft.body}`;
    case 'email_send':
      await emailAgent.composeAndSend({ to: params.to, subject: params.subject, context: params.context || userMessage }, userContext);
      return `Email sent to ${params.to}`;
    case 'github_repos':
      const repos = await githubAgent.listRepos();
      return 'Your repos:\n' + repos.map(r => `- ${r.name} (${r.stars} stars)`).join('\n');
    case 'github_analyze':
      const ga = await githubAgent.analyzeRepo(params.owner, params.repo);
      return `${params.repo} analysis:\n${ga.analysis}`;
    case 'github_push':
      await githubAgent.createOrUpdateFile(params.owner, params.repo, params.path, params.content, params.message);
      return `Pushed ${params.path} to ${params.repo}`;
    case 'image_generate':
      const img = await imageAgent.generateImage(params.prompt || userMessage);
      return img.url ? `Image ready: ${img.url}` : `Image failed: ${img.error}`;
    case 'notion_search':
      const ns = await notionAgent.searchPages(params.query || userMessage);
      return 'Notion pages:\n' + ns.map(p => `- ${p.title}`).join('\n');
    case 'notion_create':
      const nc = await notionAgent.createPage(params.parent_id, params.title, params.content || context);
      return `Notion page created: ${nc.url}`;
    case 'goal_run':
      const goal = await goalAgent.runGoal(params.goal || userMessage);
      return `Goal completed:\n${goal.results?.map(r => `- ${r.task}: ${r.status}`).join('\n')}`;
    case 'self_analyze':
      const sa = await selfAgent.analyzeSelf();
      return `Self analysis:\n${sa.analysis}`;
    case 'voice_speak':
      const vr = await voiceAgent.textToSpeech(params.text || context || userMessage);
      return vr.success ? `Speaking audio saved.` : `Voice failed: ${vr.error}`;
    case 'briefing':
      const br = await scheduler.generateBriefing();
      return `Briefing:\n${br}`;
    case 'memory_save': {
      const { safeUser = 'guest' } = userContext;
      remember(safeUser, params.key || 'note', params.value || userMessage);
      return `Remembered: ${params.key}`;
    }
    case 'memory_get': {
      const { safeUser = 'guest' } = userContext;
      const { allMemory } = require('./tools/memory');
      const all = allMemory(safeUser);
      return `Memory:\n${Object.entries(all).map(([k,v]) => `- ${k}: ${JSON.stringify(v.value)}`).join('\n')}`;
    }
      
    // Added Antigravity workspace operation routes
    case 'workspace_view_file': {
      const isPublic = (process.env.GHOST_DEPLOYMENT_MODE || 'public') === 'public';
      const { isAdmin = false } = userContext;
      if (isPublic && !isAdmin) {
        return 'Access Denied: Workspace file reading is restricted to admin clearance in public deployment mode.';
      }
      return await workspaceTools.viewFile(params);
    }
    case 'workspace_edit_file': {
      const isPublic = (process.env.GHOST_DEPLOYMENT_MODE || 'public') === 'public';
      const { isAdmin = false } = userContext;
      if (isPublic && !isAdmin) {
        return 'Access Denied: Workspace file modification is restricted to admin clearance in public deployment mode.';
      }
      return await workspaceTools.editFile(params);
    }
    case 'workspace_run_command': {
      const isPublic = (process.env.GHOST_DEPLOYMENT_MODE || 'public') === 'public';
      const { isAdmin = false } = userContext;
      if (isPublic && !isAdmin) {
        return 'Access Denied: Local shell command execution is restricted to admin clearance in public deployment mode.';
      }
      return await workspaceTools.runWorkspaceCommand(params);
    }
      
    // Added Supabase Postgres Database dynamic query route
    case 'database_query':
      return await databaseTools.executeQuery({ ...params, userContext, userGoal: userMessage });
      
    // Added Google Direct API routes via OAuth
    case 'gmail_list_unread':
      return await googleAgent.listUnreadEmails('master_manoj');
    case 'calendar_create':
      return await googleAgent.createCalendarEvent('master_manoj', userContext, params);
    case 'sheets_append':
      return await googleAgent.appendSheetsValue('master_manoj', userContext, params);
      
    // Added Local Control Daemon automation tools
    case 'local_open_url': {
      const { sendDaemonCommand } = await import('../services/localControlServer.js');
      return await sendDaemonCommand('openUrl', { url: params.url });
    }
    case 'local_open_app': {
      const { sendDaemonCommand } = await import('../services/localControlServer.js');
      return await sendDaemonCommand('openApp', { appName: params.appName });
    }
    case 'local_run_script': {
      const { sendDaemonCommand } = await import('../services/localControlServer.js');
      return await sendDaemonCommand('runScript', { script: params.script });
    }
      
    case 'mcp_call': {
      const mcpClient = await import('../mcpClient.js');
      const res = await mcpClient.callMcpTool(params.name || params.toolName, params.args || params);
      return typeof res === 'string' ? res : JSON.stringify(res);
    }
      
    default:
      if (tool && tool.startsWith('mcp_')) {
        const mcpClient = await import('../mcpClient.js');
        const res = await mcpClient.callMcpTool(tool, params);
        return typeof res === 'string' ? res : JSON.stringify(res);
      }
      return await chat([{ role: 'user', content: userMessage }], { systemPrompt: getSystemPrompt(userContext) });
  }
}

async function summarize(userMessage, actions, results) {
  let finalAnswer = '';
  
  if (actions.length === 1 && actions[0].tool === 'chat') {
    finalAnswer = results[0].output;
  } else {
    const actionLog = actions.map((a, i) => {
      let out = results[i]?.output;
      if (typeof out !== 'string') out = JSON.stringify(out) || String(out);
      return `${i+1}. ${a.tool}: ${out.slice(0, 300)}`;
    }).join('\n\n');
    finalAnswer = await chat(
      [{ role: 'user', content: `User asked: "${userMessage}"\n\nActions done:\n${actionLog}\n\nSummarize results clearly and concisely.` }],
      { systemPrompt: 'You are Ghost. Summarize actions and results for the user. Be direct and concise.' }
    );
  }

  const toolToAgent = {
    web_search: 'webAgent', web_scrape: 'webAgent',
    email_draft: 'emailAgent', email_send: 'emailAgent',
    github_repos: 'githubAgent', github_analyze: 'githubAgent', github_push: 'githubAgent',
    image_generate: 'imageAgent',
    notion_search: 'notionAgent', notion_create: 'notionAgent',
    goal_run: 'goalAgent',
    self_analyze: 'selfAgent',
    voice_speak: 'voiceAgent',
    briefing: 'scheduler',
    memory_save: 'memory', memory_get: 'memory',
    workspace_view_file: 'workspace', workspace_edit_file: 'workspace', workspace_run_command: 'workspace',
    database_query: 'database',
    gmail_list_unread: 'googleAgent', calendar_create: 'googleAgent', sheets_append: 'googleAgent',
    local_open_url: 'localControl', local_open_app: 'localControl', local_run_script: 'localControl',
    chat: 'llm'
  };

  const prefixTags = actions.map((a, i) => {
    if (a.tool === 'orchestrator_run') {
      const output = results[i]?.output || '';
      const agentMatches = [...output.matchAll(/\[Agent:\s(.*?)\]/g)].map(m => m[1]);
      const uniqueAgents = [...new Set(agentMatches)];
      const agentsStr = uniqueAgents.length > 0 ? uniqueAgents.join(', ') : 'orchestrator';
      return `[${a.tool} ➔ ${agentsStr}]`;
    }
    
    const agentName = toolToAgent[a.tool] || 'system';
    return `[${a.tool} ➔ ${agentName}]`;
  }).join(' ');

  return `${prefixTags}\n\n${finalAnswer}`.trim();
}

async function think(userMessage, userContext = { safeUser: 'guest', isAdmin: false }) {
  const username = userContext.safeUser || 'guest';
  saveMessage(username, 'user', userMessage);

  // RAG: Query relevant past memories
  const pastMemories = await queryMemory(userMessage, 3);
  const memoryContext = pastMemories && pastMemories.length > 0
    ? pastMemories.map(m => `- ${m.text}`).join('\n')
    : '';
  
  const actions = await plan(userMessage, userContext, memoryContext);
  const results = [];
  let executionSuccess = true;

  for (const action of actions) {
    try {
      const output = await execute(action, userMessage, results, userContext);
      results.push({ tool: action.tool, output, reason: action.reason, status: 'done' });
    } catch (err) {
      executionSuccess = false;
      results.push({ tool: action.tool, output: `Error: ${err.message}`, reason: action.reason, status: 'failed' });
    }
  }
  
  const reply = await summarize(userMessage, actions, results);
  saveMessage(username, 'assistant', reply);

  // Save exchange to persistent vector memory
  await saveMemory(`User: ${userMessage} | Ghost: ${reply}`, { safeUser: username });

  if (userContext.isAdmin) {
    recordLearning(
      userMessage, 
      actions.map(a => a.tool), 
      executionSuccess ? 'success' : 'failed', 
      reply.substring(0, 300)
    );
  }

  return { reply, actions: actions.map((a,i) => ({ tool: a.tool, reason: a.reason, status: results[i]?.status })) };
}

module.exports = { think, execute, extractJSON };

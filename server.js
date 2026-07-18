const { chat } = require('./tools/llm');
const { saveMessage, getHistory, remember } = require('./tools/memory');
const webAgent = require('./agents/webAgent');
const emailAgent = require('./agents/emailAgent');
const githubAgent = require('./agents/githubAgent');
const imageAgent = require('./agents/imageAgent');
const notionAgent = require('./agents/notionAgent');
const voiceAgent = require('./agents/voiceAgent');
const goalAgent = require('./agents/goalAgent');
const selfAgent = require('./agents/selfAgent');
const scheduler = require('./agents/scheduler');

async function plan(userMessage) {
  // Direct detection for code blocks — highest priority
  if (userMessage.includes('```python') || userMessage.includes('```js') || userMessage.includes('```bash')) {
    return [{ tool: 'chat', params: {}, reason: 'Code block detected — pass to LLM for execution' }];
  }
  
  // Python code generation requests
  if ((userMessage.toLowerCase().includes('python') || userMessage.toLowerCase().includes('write code') || userMessage.toLowerCase().includes('calculate') || userMessage.toLowerCase().includes('script')) && 
      !userMessage.toLowerCase().includes('github')) {
    return [{ tool: 'chat', params: {}, reason: 'Code execution via LLM' }];
  }
  
  // Web search explicit requests
  if (userMessage.toLowerCase().includes('search') || userMessage.toLowerCase().includes('latest') || userMessage.toLowerCase().includes('news') || userMessage.toLowerCase().includes('current')) {
    return [{ tool: 'web_search', params: { query: userMessage }, reason: 'Web search explicitly requested' }];
  }
  
  // GitHub tasks
  if (userMessage.toLowerCase().includes('github') && (userMessage.toLowerCase().includes('repo') || userMessage.toLowerCase().includes('repository') || userMessage.toLowerCase().includes('trending'))) {
    return [{ tool: 'github_repos', params: {}, reason: 'GitHub repository task detected' }];
  }
  
  // Email tasks
  if (userMessage.toLowerCase().includes('email') || userMessage.toLowerCase().includes('send') && userMessage.toLowerCase().includes('mail')) {
    return [{ tool: 'email_draft', params: {}, reason: 'Email composition requested' }];
  }
  
  // Image generation
  if (userMessage.toLowerCase().includes('generate') || userMessage.toLowerCase().includes('create') && (userMessage.toLowerCase().includes('image') || userMessage.toLowerCase().includes('draw'))) {
    return [{ tool: 'image_generate', params: { prompt: userMessage }, reason: 'Image generation requested' }];
  }
  
  // Default: general conversation via chat
  return [{ tool: 'chat', params: {}, reason: 'General conversation — route to LLM' }];
}

async function execute(action, userMessage, previousResults = []) {
  const { tool, params } = action;
  const context = previousResults.map(r => r.output).join('\n');
  switch (tool) {
    case 'chat':
      return await chat([...getHistory(15), { role: 'user', content: userMessage }], { systemPrompt: 'You are Ghost, a sharp autonomous AI assistant for Manoj. Be concise and helpful. Execute code blocks if present.' });
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
      await emailAgent.composeAndSend({ to: params.to, subject: params.subject, context: params.context || userMessage });
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
    case 'memory_save':
      remember(params.key || 'note', params.value || userMessage);
      return `Remembered: ${params.key}`;
    case 'memory_get':
      const { allMemory } = require('./tools/memory');
      const all = allMemory();
      return `Memory:\n${Object.entries(all).map(([k,v]) => `- ${k}: ${JSON.stringify(v.value)}`).join('\n')}`;
    default:
      return await chat([{ role: 'user', content: userMessage }], { systemPrompt: 'You are Ghost.' });
  }
}

async function summarize(userMessage, actions, results) {
  if (actions.length === 1 && actions[0].tool === 'chat') return results[0].output;
  const actionLog = actions.map((a, i) => `${i+1}. ${a.tool}: ${results[i]?.output?.slice(0,300)}`).join('\n\n');
  return await chat(
    [{ role: 'user', content: `User asked: "${userMessage}"\n\nActions done:\n${actionLog}\n\nSummarize results clearly and concisely.` }],
    { systemPrompt: 'You are Ghost. Summarize actions and results. Be direct and concise.' }
  );
}

async function think(userMessage) {
  saveMessage('user', userMessage);
  const actions = await plan(userMessage);
  const results = [];
  for (const action of actions) {
    try {
      const output = await execute(action, userMessage, results);
      results.push({ tool: action.tool, output, reason: action.reason, status: 'done' });
    } catch (err) {
      results.push({ tool: action.tool, output: `Error: ${err.message}`, reason: action.reason, status: 'failed' });
    }
  }
  const reply = await summarize(userMessage, actions, results);
  saveMessage('assistant', reply);
  return { reply, actions: actions.map((a,i) => ({ tool: a.tool, reason: a.reason, status: results[i]?.status })) };
}

module.exports = { think };
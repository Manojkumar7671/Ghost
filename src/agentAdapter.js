const { chat } = require('./tools/llm');
const webAgent = require('./agents/webAgent');
const emailAgent = require('./agents/emailAgent');
const githubAgent = require('./agents/githubAgent');
const imageAgent = require('./agents/imageAgent');
const notionAgent = require('./agents/notionAgent');
const voiceAgent = require('./agents/voiceAgent');
const goalAgent = require('./agents/goalAgent');
const selfAgent = require('./agents/selfAgent');
const scheduler = require('./agents/scheduler');
const dailyBriefingAgent = require('./agents/dailyBriefingAgent');
const codeReviewAgent = require('./agents/codeReviewAgent');
const selfStudyAgent = require('./agents/selfStudyAgent');
const stockAgent = require('./agents/stockAgent');
const docAgent = require('./agents/docAgent');
const sysMonAgent = require('./agents/sysMonAgent');
const FileAgent = require('./agents/fileAgent');
const CodeAgent = require('./agents/codeAgent');
const { saveMessage } = require('./tools/memory');

// Helper function to extract structured parameters from a natural language task
async function extractParams(agentName, task, context, jsonSchemaInstruction) {
  const prompt = `You are a parameter extractor for the ${agentName}.
Task: "${task}"
Context: "${context}"

Instructions: ${jsonSchemaInstruction}

Respond ONLY with a valid JSON object. No markdown, no explanation.`;
  
  const res = await chat([{ role: 'user', content: prompt }], { maxTokens: 300 });
  try {
    return JSON.parse(res.replace(/```json|```/g, '').trim());
  } catch (e) {
    console.error(`[Adapter] Failed to parse JSON for ${agentName}:`, res);
    return null;
  }
}

const adaptedWebAgent = {
  run: async (task, context) => {
    const params = await extractParams('webAgent', task, context, 
      `Return JSON with "action" ("search" or "scrape") and "url_or_query" (the search term or URL).`
    );
    if (!params) return "Error: Failed to parse parameters for web request.";
    
    if (params.action === 'scrape') {
      const sc = await webAgent.scrapeAndSummarize(params.url_or_query);
      return sc.summary || JSON.stringify(sc);
    }
    const sr = await webAgent.searchWeb(params.url_or_query);
    return sr.summary || JSON.stringify(sr);
  }
};

const adaptedEmailAgent = {
  run: async (task, context) => {
    const params = await extractParams('emailAgent', task, context, 
      `Return JSON with "action" ("draft" or "send"), "to" (email address), "subject", and "body". Use context if body is missing.`
    );
    if (!params) return "Error: Failed to parse parameters for email.";
    
    const payload = { to: params.to || '', subject: params.subject || task, context: params.body || context || task };
    if (params.action === 'send') {
      await emailAgent.composeAndSend(payload);
      return `Email sent to ${payload.to}`;
    }
    const draft = await emailAgent.draftEmail(payload);
    return `Email drafted to ${draft.to}:\nSubject: ${draft.subject}\n\n${draft.body}`;
  }
};

const adaptedGithubAgent = {
  run: async (task, context) => {
    const params = await extractParams('githubAgent', task, context, 
      `Return JSON with "action" ("list", "analyze", "push"), "owner", "repo", "path", "content", and "message". Leave missing fields empty.`
    );
    if (!params) return "Error: Failed to parse parameters for GitHub.";
    
    switch (params.action) {
      case 'list':
        const repos = await githubAgent.listRepos();
        return 'Your repos:\n' + repos.map(r => `- ${r.name} (${r.stars} stars)`).join('\n');
      case 'analyze':
        const ga = await githubAgent.analyzeRepo(params.owner, params.repo);
        return `${params.repo} analysis:\n${ga.analysis}`;
      case 'push':
        await githubAgent.createOrUpdateFile(params.owner, params.repo, params.path, params.content, params.message);
        return `Pushed ${params.path} to ${params.repo}`;
      default:
        return "Invalid GitHub action.";
    }
  }
};

const adaptedImageAgent = {
  run: async (task, context) => {
    const params = await extractParams('imageAgent', task, context, 
      `Return JSON with a single key "prompt" containing the detailed image generation prompt.`
    );
    const img = await imageAgent.generateImage(params?.prompt || task);
    return img.url ? `Image ready: ${img.url}` : `Image failed: ${img.error}`;
  }
};

const adaptedNotionAgent = {
  run: async (task, context) => {
    const params = await extractParams('notionAgent', task, context, 
      `Return JSON with "action" ("search" or "create"), "query", "parent_id", "title", and "content".`
    );
    if (!params) return "Error: Failed to parse Notion parameters.";
    
    if (params.action === 'create') {
      const nc = await notionAgent.createPage(params.parent_id, params.title, params.content || context || task);
      return `Notion page created: ${nc.url}`;
    }
    const ns = await notionAgent.searchPages(params.query || task);
    return 'Notion pages:\n' + ns.map(p => `- ${p.title}`).join('\n');
  }
};

const adaptedGoalAgent = {
  run: async (task, context) => {
    const goal = await goalAgent.runGoal(task);
    return `Goal completed:\n${goal.results?.map(r => `- ${r.task}: ${r.status}`).join('\n')}`;
  }
};

const adaptedSelfAgent = {
  run: async (task, context) => {
    const sa = await selfAgent.analyzeSelf();
    return `Self analysis:\n${sa.analysis}`;
  }
};

const adaptedVoiceAgent = {
  run: async (task, context) => {
    const params = await extractParams('voiceAgent', task, context, 
      `Return JSON with a single key "text" containing the text to be spoken.`
    );
    const vr = await voiceAgent.textToSpeech(params?.text || task);
    return vr.success ? `Speaking audio saved.` : `Voice failed: ${vr.error}`;
  }
};

const adaptedScheduler = {
  run: async (task, context) => {
    const br = await scheduler.generateBriefing();
    return `Briefing:\n${br}`;
  }
};

const adaptedStockAgent = {
  run: async (task, context) => {
    const res = await stockAgent.run(task);
    if (typeof res === 'string') return res;
    return res.text || JSON.stringify(res);
  }
};

const adaptedDocAgent = {
  run: async (task, context) => {
    const res = await docAgent.queryWithPageIndex ? await docAgent.queryWithPageIndex(task) : await docAgent.run(task);
    if (typeof res === 'string') return res;
    return res.text || res.answer || JSON.stringify(res);
  }
};

const adaptedSysMonAgent = {
  run: async (task, context) => {
    const res = await sysMonAgent.getSystemHealth ? await sysMonAgent.getSystemHealth() : await sysMonAgent.run(task);
    if (typeof res === 'string') return res;
    return res.text || JSON.stringify(res);
  }
};

const adaptedCodeAgent = {
  run: async (task, context) => {
    const res = await codeAgent.run(task, context);
    if (res.success) {
      return `Code executed successfully. Output:\n${res.output}\n\nCode:\n${res.code}`;
    } else {
      return `Code execution failed. Error:\n${res.error}\n\nCode:\n${res.code}`;
    }
  }
};

const adaptedFileAgent = {
  run: async (task) => {
    const res = await fileAgent.run(task);
    return JSON.stringify(res, null, 2);
  }
};

const { AiderAgent } = require('./agents/aiderAgent');
const aiderAgent = new AiderAgent();

const adaptedAiderAgent = {
  run: async (task, context) => {
    const params = await extractParams('aiderAgent', task, context, 
      `Return JSON with "owner" (GitHub repo owner/org), "repo" (GitHub repository name), and "prompt" (detailed instruction for Aider). Extract the owner and repo explicitly from the task or context.`
    );
    if (!params || !params.owner || !params.repo) {
      return "Missing owner or repo for Aider task. Task must specify a GitHub repository.";
    }
    const res = await aiderAgent.run(params.prompt || task, context, params.owner, params.repo);
    return typeof res === 'string' ? res : JSON.stringify(res);
  }
};

module.exports = {
  webAgent: adaptedWebAgent,
  emailAgent: adaptedEmailAgent,
  githubAgent: adaptedGithubAgent,
  imageAgent: adaptedImageAgent,
  notionAgent: adaptedNotionAgent,
  goalAgent: adaptedGoalAgent,
  selfAgent: adaptedSelfAgent,
  voiceAgent: adaptedVoiceAgent,
  scheduler: adaptedScheduler,
  dailyBriefingAgent,
  codeReviewAgent,
  selfStudyAgent,
  stockAgent: adaptedStockAgent,
  docAgent: adaptedDocAgent,
  sysMonAgent: adaptedSysMonAgent,
  fileAgent: adaptedFileAgent,
  codeAgent: adaptedCodeAgent,
  aiderAgent: adaptedAiderAgent
};
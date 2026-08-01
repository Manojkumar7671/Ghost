const { chat } = require('../tools/llm');
const fs = require('fs');
const path = require('path');
const standardAgents = require('../agentAdapter');

const availableAgents = { ...standardAgents };
const AGENTS_METADATA_FILE = path.join(__dirname, '../../state/dynamic_agents.json');

// Ensure the state folder exists
const stateDir = path.dirname(AGENTS_METADATA_FILE);
if (!fs.existsSync(stateDir)) {
  fs.mkdirSync(stateDir, { recursive: true });
}

// 1. Initialize and load dynamic agents from metadata JSON instead of raw JS files
if (fs.existsSync(AGENTS_METADATA_FILE)) {
  try {
    const raw = fs.readFileSync(AGENTS_METADATA_FILE, 'utf-8');
    const metadata = JSON.parse(raw);
    for (const [name, instructions] of Object.entries(metadata)) {
      instantiateVirtualAgent(name, instructions);
    }
  } catch (err) {
    console.error("[Orchestrator] Failed to load dynamic agents metadata:", err.message);
  }
}

// Helper to instantiate virtual in-memory agents (safe context propagation)
function instantiateVirtualAgent(name, instructions) {
  availableAgents[name] = {
    run: async (task, context = '') => {
      const systemPrompt = `You are an autonomous AI agent named ${name}. 
Your exact instructions are: ${instructions}

Context provided from prior steps:
${context}`;
      return await chat([{ role: 'user', content: task }], { systemPrompt });
    }
  };
}

// 2. Dynamic Agent Creation (Secure JSON metadata-driven persistence)
function createAgent(name, instructions) {
  const safeName = name.replace(/[^a-zA-Z0-9_]/g, '');
  
  // Register the agent in memory
  instantiateVirtualAgent(safeName, instructions);
  console.log(`[Orchestrator] [${new Date().toISOString()}] [TriggerSource: automated_flow] Spun up new virtual agent: ${safeName}`);

  // Persist the metadata to dynamic_agents.json
  try {
    let metadata = {};
    if (fs.existsSync(AGENTS_METADATA_FILE)) {
      metadata = JSON.parse(fs.readFileSync(AGENTS_METADATA_FILE, 'utf-8'));
    }
    metadata[safeName] = instructions;
    fs.writeFileSync(AGENTS_METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf-8');
  } catch (err) {
    console.error("[Orchestrator] Failed to save dynamic agent metadata:", err.message);
  }

  return availableAgents[safeName];
}

// 3. Evaluation and Subtask Routing
async function getPlanMemory() {
  try {
    return await import('../../services/planMemory.js');
  } catch {
    return null;
  }
}

/**
 * Detects underspecified or ambiguous user goals missing critical parameters.
 */
function detectAmbiguity(primaryGoal) {
  const lowerGoal = primaryGoal.toLowerCase();

  // Email missing target email address or content
  if (/\b(send email|email|draft email)\b/i.test(lowerGoal)) {
    const hasEmailAddr = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(primaryGoal);
    const hasBodyContent = /\b(saying|with body|message|content|about|that)\b/i.test(lowerGoal);
    if (!hasEmailAddr || !hasBodyContent) {
      return {
        isAmbiguous: true,
        question: "To send an email, please specify the recipient's email address and the message body/subject content."
      };
    }
  }

  // Code push missing repo or commit message
  if (/\b(push code|git push|commit code)\b/i.test(lowerGoal)) {
    const hasRepoOrCommit = /\b(repo|repository|commit|message|branch)\b/i.test(lowerGoal);
    if (!hasRepoOrCommit) {
      return {
        isAmbiguous: true,
        question: "To push code, please specify the target repository/branch and commit message."
      };
    }
  }

  // PDF / Document QA missing filename
  if (/\b(summarize document|read pdf|parse resume|pdf qa)\b/i.test(lowerGoal)) {
    const hasDocFile = /\b(\.pdf|\.docx|\.txt|document|file|resume)\b/i.test(lowerGoal);
    if (!hasDocFile) {
      return {
        isAmbiguous: true,
        question: "To process a document, please provide the specific file name or file path."
      };
    }
  }

  return { isAmbiguous: false };
}

async function evaluate(subtask) {
  const lowerSub = subtask.toLowerCase();

  // Fast domain keyword routing with explicit reasoning logging
  let domainMatch = null;
  let domainReason = '';

  if (/\b(stock|stock price|financial metrics|aapl|googl|msft|nasdaq)\b/i.test(lowerSub) && availableAgents.stockAgent) {
    domainMatch = 'stockAgent';
    domainReason = 'Subtask targets stock market quotes or financial metrics.';
  } else if (/\b(repo|github|commit|pull request|issue)\b/i.test(lowerSub) && availableAgents.githubAgent) {
    domainMatch = 'githubAgent';
    domainReason = 'Subtask targets GitHub repository or version control operations.';
  } else if (/\b(pdf|document|pageindex|resume)\b/i.test(lowerSub) && availableAgents.docAgent) {
    domainMatch = 'docAgent';
    domainReason = 'Subtask targets document indexing or PDF QA.';
  } else if (/\b(cpu|memory|disk|system health|system metrics)\b/i.test(lowerSub) && availableAgents.sysMonAgent) {
    domainMatch = 'sysMonAgent';
    domainReason = 'Subtask targets system hardware monitoring and diagnostics.';
  } else if (/\b(daily briefing|morning summary)\b/i.test(lowerSub) && availableAgents.dailyBriefingAgent) {
    domainMatch = 'dailyBriefingAgent';
    domainReason = 'Subtask targets morning briefing generation.';
  } else if (/\b(code review|refactor|lint)\b/i.test(lowerSub) && availableAgents.codeReviewAgent) {
    domainMatch = 'codeReviewAgent';
    domainReason = 'Subtask targets automated code review and quality checks.';
  } else if (/\b(quiz|spaced repetition|self study)\b/i.test(lowerSub) && availableAgents.selfStudyAgent) {
    domainMatch = 'selfStudyAgent';
    domainReason = 'Subtask targets user learning or spaced-repetition quizzes.';
  } else if (/\b(send email|draft email)\b/i.test(lowerSub) && availableAgents.emailAgent) {
    domainMatch = 'emailAgent';
    domainReason = 'Subtask targets email composition and dispatch.';
  }

  if (domainMatch) {
    console.log(`[Orchestrator Agent Selector] Selected domain-specific agent "${domainMatch}" for subtask "${subtask}". Reasoning: ${domainReason}`);
    return { name: domainMatch, agent: availableAgents[domainMatch] };
  }

  const agentNames = Object.keys(availableAgents).join(', ');
  const prompt = `You are Ghost's Orchestrator. Decide which agent should handle this subtask: "${subtask}"

Available existing agents: ${agentNames}

If none of the existing agents perfectly fit this task, respond EXACTLY in this format to create a new one on the fly:
CREATE: AgentName - Detailed system instructions for how the new agent should behave.

If an existing agent fits, respond EXACTLY with just the agent's name.`;

  const decision = await chat([{ role: 'user', content: prompt }], { maxTokens: 150 });
  const result = decision.trim();

  if (result.startsWith('CREATE:')) {
    const parts = result.substring(7).split('-');
    const name = parts[0].trim();
    const instructions = parts.slice(1).join('-').trim();
    const agent = createAgent(name, instructions);
    return { name, agent };
  }

  if (availableAgents[result]) {
    return { name: result, agent: availableAgents[result] };
  }

  return {
    name: 'genericDynamic',
    agent: createAgent('genericDynamic', 'You are a general-purpose execution agent.')
  };
}

// Helper: Check if a subtask is relevant to the primary goal
async function isSubtaskRelevant(primaryGoal, subtask) {
  const lowerGoal = primaryGoal.toLowerCase();
  const lowerSub = subtask.toLowerCase();

  // Fast heuristic exclusions for known runaway patterns
  if (lowerGoal.includes('website') || lowerGoal.includes('web app') || lowerGoal.includes('site') || lowerGoal.includes('portfolio') || lowerGoal.includes('resume')) {
    if (lowerSub.includes('briefing') || lowerSub.includes('scheduler') || lowerSub.includes('morning') || lowerSub.includes('stock') || lowerSub.includes('email') || lowerSub.includes('database') || lowerSub.includes('npm install')) {
      console.log(`[Orchestrator Relevance Filter] Rejected irrelevant subtask "${subtask}" for website goal "${primaryGoal}"`);
      return false;
    }
  }

  // LLM relevance verification
  try {
    const relPrompt = `Primary User Goal: "${primaryGoal}"\nProposed Subtask: "${subtask}"\nDoes this subtask directly contribute to achieving the primary user goal? Respond ONLY with YES or NO.`;
    const ans = await chat([{ role: 'user', content: relPrompt }], { maxTokens: 10 });
    const isRel = ans.trim().toUpperCase().includes('YES');
    if (!isRel) {
      console.log(`[Orchestrator Relevance Filter] LLM marked subtask "${subtask}" as IRRELEVANT to goal "${primaryGoal}"`);
    }
    return isRel;
  } catch {
    return true;
  }
}

/**
 * Multi-Step Plan Critique Pass: Self-reviews the entire subtask DAG
 * and trims non-essential or duplicate steps before execution starts.
 */
async function critiquePlan(primaryGoal, subtasks) {
  if (!subtasks || subtasks.length <= 1) return subtasks;

  const prompt = `You are Ghost's Senior Plan Auditor. 
Primary User Goal: "${primaryGoal}"
Proposed Subtasks: ${JSON.stringify(subtasks)}

Evaluate each subtask. Remove any steps that are redundant, unneeded, or off-topic.
Return ONLY a valid JSON array containing the approved essential subtasks. No markdown.`;

  try {
    const res = await chat([{ role: 'user', content: prompt }], { maxTokens: 250 });
    const match = res.match(/\[.*\]/s);
    if (match) {
      const critiqued = JSON.parse(match[0]);
      if (Array.isArray(critiqued) && critiqued.length > 0) {
        console.log(`[Orchestrator Plan Critique] Critiqued plan: ${subtasks.length} -> ${critiqued.length} subtasks`);
        return critiqued;
      }
    }
  } catch (e) {
    console.warn('[Orchestrator Plan Critique] Critique pass failed, retaining original plan:', e.message);
  }
  return subtasks;
}

/**
 * Evaluates confidence (0.0 to 1.0) and safety risk per subtask step.
 * Flags steps for user confirmation if confidence < 0.70 or if action is high-risk.
 */
async function evaluateStepConfidence(primaryGoal, subtask, agentName) {
  const CONFIDENCE_THRESHOLD = 0.70;
  const lowerSub = subtask.toLowerCase();
  
  // High-risk keyword check (destruction, deployment, file deletion, root commands)
  const isHighRisk = /\b(delete|rm -rf|drop|wipe|erase|deploy to prod|shutdown|clean up old)\b/i.test(lowerSub);

  const prompt = `Primary Goal: "${primaryGoal}"
Subtask: "${subtask}"
Assigned Agent: "${agentName}"

Rate your confidence (0.0 to 1.0) that this tool/agent and subtask parameters are well-defined, safe, and clear without requiring user clarification.
Respond ONLY with a JSON object: {"confidence": 0.85, "reason": "Clear subtask definition"}`;

  try {
    const res = await chat([{ role: 'user', content: prompt }], { maxTokens: 100 });
    const match = res.match(/\{.*\}/s);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.8;
      const requiresConfirmation = confidence < CONFIDENCE_THRESHOLD || isHighRisk;
      return {
        confidence,
        requiresConfirmation,
        reason: isHighRisk ? `High-risk destructive/deployment action detected: "${subtask}"` : (parsed.reason || 'Low planner confidence')
      };
    }
  } catch (e) {}

  return {
    confidence: isHighRisk ? 0.50 : 0.85,
    requiresConfirmation: isHighRisk,
    reason: isHighRisk ? 'High-risk action detected' : 'Standard confidence'
  };
}

// 4. Execution Engine with Relevance Filtering, Plan Critique, Confidence Scoring, and Blocker Surface
async function run(task, globalContext = '') {
  const MAX_TOOL_CALLS = 8;
  let toolCallCount = 0;
  const blockedAgents = new Set();
  const blockerWarnings = [];

  // 1. Primary Goal Extraction
  let primaryGoal = task;
  const lowerTask = task.toLowerCase();
  if (lowerTask.includes('floor plan') || lowerTask.includes('cad drawing') || lowerTask.includes('architectural blueprint') || lowerTask.includes('3d model')) {
    console.log(`[Orchestrator] Rejecting out-of-scope task: "${task}"`);
    return `Ghost is a Jarvis-style assistant focused on information, automation, communications, and memory. Floor plan generation and CAD design are out of scope.`;
  }
  if (task.includes('[neutralized request]') || /\b(system override|superuser admin|grant admin)\b/i.test(task)) {
    console.log(`[Orchestrator Security Boundary] Neutralizing prompt injection request: "${task}"`);
    return "System override and privilege escalation requests are denied by Ghost security policy.";
  }
  if (task.length > 150 || task.includes('\n')) {
    try {
      const goalPrompt = `Extract ONLY the core actionable user command from the input below. Ignore passive reference text, background descriptions, and feature lists.
User Input: "${task.substring(0, 1000)}"
Return ONLY a single concise sentence describing the user's primary goal.`;
      const extracted = await chat([{ role: 'user', content: goalPrompt }], { maxTokens: 60 });
      if (extracted && extracted.trim()) {
        primaryGoal = extracted.trim();
        console.log(`[Orchestrator Goal Extractor] Extracted primary goal: "${primaryGoal}" from raw input (${task.length} chars)`);
      }
    } catch (e) {}
  }

  // 2. Ambiguity Clarification Gating
  const ambiguityCheck = detectAmbiguity(primaryGoal);
  if (ambiguityCheck.isAmbiguous) {
    console.log(`[Orchestrator Ambiguity Gate] Gating ambiguous request: "${primaryGoal}"`);
    return `[AMBIGUITY CLARIFICATION REQUIRED]: ${ambiguityCheck.question}`;
  }

  // 3. Subtask Decomposition or Plan Memory Reuse
  let subtasks = [];
  const planMem = await getPlanMemory();
  const cachedPlan = planMem?.getMatchingPlanStructure ? planMem.getMatchingPlanStructure(primaryGoal) : null;

  if (cachedPlan && Array.isArray(cachedPlan.subtasks) && cachedPlan.subtasks.length > 0) {
    subtasks = cachedPlan.subtasks;
    console.log(`[Orchestrator Plan Memory] Reusing proven plan structure (${subtasks.length} subtask(s)) for goal: "${primaryGoal}"`);
  } else {
    const planPrompt = `Break this primary goal down into 1 to 3 distinct actionable subtasks. 
Goal: "${primaryGoal}"
Respond ONLY with a JSON array of string subtasks. No markdown.`;

    try {
      const planRes = await chat([{ role: 'user', content: planPrompt }]);
      subtasks = JSON.parse(planRes.match(/\[.*\]/s)[0]);
    } catch (e) {
      subtasks = [primaryGoal];
    }
  }

  // 4. Multi-Step Plan Critique Pass
  subtasks = await critiquePlan(primaryGoal, subtasks);

  // 4. Sequential & Relevant Subtask Execution with Confidence Gating & Hard Cap (Max 8)
  const results = [];
  for (const st of subtasks) {
    if (toolCallCount >= MAX_TOOL_CALLS) {
      console.warn(`[Orchestrator Hard Cap] Reached max tool execution limit (${MAX_TOOL_CALLS} calls). Halting subtasks.`);
      results.push(`[Ghost System]: Reached max tool execution limit (${MAX_TOOL_CALLS} calls per turn). Halting further automated subtasks to prevent runaways.`);
      break;
    }

    // Check relevance against primary goal
    const relevant = await isSubtaskRelevant(primaryGoal, st);
    if (!relevant) {
      results.push(`[Agent: Skipped] Subtask: "${st}"\nResult: Skipped (Filtered out as irrelevant to primary goal "${primaryGoal}").`);
      continue;
    }

    let { name, agent } = await evaluate(st);

    // Confidence & Safety Risk Evaluation Pass
    const stepEval = await evaluateStepConfidence(primaryGoal, st, name);
    console.log(`[Orchestrator Step Confidence] Subtask: "${st}" | Confidence: ${stepEval.confidence.toFixed(2)} | Confirmation Required: ${stepEval.requiresConfirmation}`);

    if (stepEval.requiresConfirmation) {
      results.push(`[Agent: ${name}] Subtask: "${st}"\n[CONFIRMATION REQUIRED]: Confidence rating ${stepEval.confidence.toFixed(2)} (< 0.70 threshold or high-risk action). Reason: ${stepEval.reason}. Execution paused awaiting user confirmation.`);
      continue;
    }

    // Blocker Check: Skip agents known to be offline or failing auth
    if (blockedAgents.has(name)) {
      console.log(`[Orchestrator Blocker] Skipping blocked agent "${name}" for subtask "${st}"`);
      results.push(`[Agent: ${name}] Subtask: "${st}"\nResult: Skipped (Agent "${name}" is blocked due to invalid/expired API key).`);
      continue;
    }

    toolCallCount++;
    let result = '';
    let attempts = 0;
    const maxAttempts = 2;
    let success = false;
    let lastError = null;

    while (attempts < maxAttempts && !success) {
      attempts++;
      try {
        if (agent && typeof agent.run === 'function') {
          result = await agent.run(st, globalContext);
          
          const lowerRes = (result || '').toLowerCase();
          
          // Real Blocker Detection (API Key / Auth Failure)
          if (lowerRes.includes('invalid_api_key') || lowerRes.includes('expired api key') || lowerRes.includes('api key invalid') || lowerRes.includes('401 unauthorized') || lowerRes.includes('invalid api key')) {
            blockedAgents.add(name);
            const warningMsg = `[Blocker Surface]: Agent "${name}" failed due to invalid/expired API key. Disabling ${name} for this turn.`;
            blockerWarnings.push(warningMsg);
            console.warn(`[Orchestrator Blocker Surface] ${warningMsg}`);
            throw new Error(`API Key/Auth Failure: ${result.substring(0, 100)}`);
          }

          // Detect generic failures
          if (lowerRes.includes('error:') || lowerRes.includes('404 not found') || lowerRes.includes('failed to fetch') || lowerRes.includes('rate limit exceeded') || lowerRes.includes('cannot complete') || lowerRes.includes('unable to handle')) {
            throw new Error(`Execution returned fallback-triggering result: ${result.substring(0, 100)}`);
          }
          success = true;
        } else {
          throw new Error(`Agent ${name} missing standard run() method.`);
        }
      } catch (err) {
        lastError = err;
        console.warn(`[Orchestrator] Attempt ${attempts} failed for subtask "${st}" using agent ${name}: ${err.message}`);
        
        if (attempts < maxAttempts && !blockedAgents.has(name)) {
          console.log(`[Orchestrator] Retrying subtask "${st}" with alternate approach.`);
          agent = createAgent('genericFallback', 'You are a general-purpose fallback assistant. Find alternative ways to achieve the user goal if direct tools fail.');
          name = 'genericFallback';
        }
      }
    }

    if (!success) {
      if (blockedAgents.has(name)) {
        result = `[Blocker Surface]: Step skipped — Agent "${name}" requires a valid API key.`;
      } else {
        const reframePrompt = `The task "${st}" failed with error: "${lastError ? lastError.message : 'Unknown failure'}". Write a brief, solution-oriented response explaining what happened and suggested next steps.`;
        try {
          result = await chat([{ role: 'user', content: reframePrompt }], { maxTokens: 150 });
        } catch (e) {
          result = `I encountered an issue executing this step: ${lastError ? lastError.message : 'Unknown error'}.`;
        }
      }
    }

    results.push(`[Agent: ${name}] Subtask: "${st}"\nResult: ${result}`);
  }

  // Record proven plan structure if execution completed
  if (planMem?.recordPlanStructure && subtasks.length > 0) {
    try {
      planMem.recordPlanStructure(primaryGoal, subtasks);
    } catch (e) {}
  }

  const finalOutput = results.join('\n\n---\n\n');
  if (blockerWarnings.length > 0) {
    return `${blockerWarnings.join('\n')}\n\n${finalOutput}`;
  }
  return finalOutput;
}

module.exports = { run, evaluate, createAgent };

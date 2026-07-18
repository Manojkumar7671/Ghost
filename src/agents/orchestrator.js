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
  console.log(`[Orchestrator] Spun up new virtual agent: ${safeName}`);

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
async function evaluate(subtask) {
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

// 4. Parallel Execution Engine
async function run(task, globalContext = '') {
  const planPrompt = `Break this task down into 1 to 3 distinct subtasks. 
If they can be done in parallel, list them. 
Task: "${task}"
Respond ONLY with a JSON array of string subtasks. No markdown.`;

  let subtasks = [];
  try {
    const planRes = await chat([{ role: 'user', content: planPrompt }]);
    subtasks = JSON.parse(planRes.match(/\[.*\]/s)[0]);
  } catch (e) {
    subtasks = [task];
  }

  const promises = subtasks.map(async (st) => {
    const { name, agent } = await evaluate(st);
    let result = '';

    try {
      if (agent && typeof agent.run === 'function') {
        result = await agent.run(st, globalContext);
      } else {
        result = `Agent ${name} missing standard run() method.`;
      }
    } catch (err) {
      result = `Error executing ${name}: ${err.message}`;
    }

    return `[Agent: ${name}] Subtask: "${st}"\nResult: ${result}`;
  });

  const results = await Promise.all(promises);
  return results.join('\n\n---\n\n');
}

module.exports = { run, evaluate, createAgent };

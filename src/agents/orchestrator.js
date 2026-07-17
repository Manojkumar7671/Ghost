const { chat } = require('./tools/llm');
const fs = require('fs');
const path = require('path');

// Import the wrapped standard agents that guarantee a .run(task, context) interface
const standardAgents = require('./agentAdapter');

// Reference existing standard agents wrapped with .run()
const availableAgents = { ...standardAgents };

const DYNAMIC_AGENTS_DIR = path.join(__dirname, 'agents', 'dynamic');

// 1. Load any previously created dynamic agents on boot
if (!fs.existsSync(DYNAMIC_AGENTS_DIR)) {
  fs.mkdirSync(DYNAMIC_AGENTS_DIR, { recursive: true });
} else {
  const files = fs.readdirSync(DYNAMIC_AGENTS_DIR).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const agentName = file.replace('.js', '');
    // Dynamic agents already export a .run() method by design
    availableAgents[agentName] = require(path.join(DYNAMIC_AGENTS_DIR, file));
  }
}

// 2. Dynamic Agent Creation
function createAgent(name, instructions) {
  const safeName = name.replace(/[^a-zA-Z0-9_]/g, '');
  const filePath = path.join(DYNAMIC_AGENTS_DIR, `${safeName}.js`);
  
  const code = `
const { chat } = require('../../tools/llm');

async function run(task, context = '') {
  const systemPrompt = \`You are an autonomous AI agent named ${safeName}. 
Your exact instructions are: ${instructions}

Context provided from prior steps:
\${context}\`;

  return await chat([{ role: 'user', content: task }], { systemPrompt });
}

module.exports = { run };
`;

  fs.writeFileSync(filePath, code.trim());
  console.log(`[Orchestrator] Spun up new dynamic agent: ${safeName}`);
  
  // Require and cache it immediately
  const newAgent = require(filePath);
  availableAgents[safeName] = newAgent;
  return newAgent;
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

  // Fallback if the LLM hallucinates an agent name
  return { 
    name: 'genericDynamic', 
    agent: createAgent('genericDynamic', 'You are a general-purpose execution agent.') 
  };
}

// 4. Parallel Execution Engine
async function run(task, globalContext = '') {
  // Break down complex tasks into parallel subtasks
  const planPrompt = `Break this task down into 1 to 3 distinct subtasks. 
If they can be done in parallel, list them. 
Task: "${task}"
Respond ONLY with a JSON array of string subtasks. No markdown.`;
  
  let subtasks = [];
  try {
    const planRes = await chat([{ role: 'user', content: planPrompt }]);
    subtasks = JSON.parse(planRes.match(/\[.*\]/s)[0]);
  } catch (e) {
    subtasks = [task]; // Fallback to single task
  }

  // Execute in parallel
  const promises = subtasks.map(async (st) => {
    const { name, agent } = await evaluate(st);
    let result = '';
    
    try {
      if (typeof agent.run === 'function') {
        result = await agent.run(st, globalContext);
      } else {
        // We shouldn't hit this anymore since all standard and dynamic agents have .run()
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
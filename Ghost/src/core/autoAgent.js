require('dotenv').config();
const ghost = require('./ghost');
const { GhostTools } = require('../tools/ghostTools');

const AGENT_SYSTEM = `
You are GHOST. Respond ONLY with valid JSON, no other text.

Format:
{
  "response": "your message to operator",
  "agents": [
    {"name": "RESEARCH-1", "specialty": "web research", "task": "specific task"}
  ],
  "tools": [
    {"tool": "web_search", "query": "search query"}
  ]
}

Rules:
- Always include "response"
- "agents" and "tools" can be empty arrays
- Spawn agents for complex tasks
- Use tools for quick lookups
`;

async function runAutoAgent(userMessage) {
  const planMessages = [
    { role: 'system', content: AGENT_SYSTEM },
    { role: 'user', content: userMessage }
  ];

  let planText = await ghost.queryLLM(planMessages);

  let plan;
  try {
    const jsonMatch = planText.match(/\{[\s\S]*\}/);
    plan = JSON.parse(jsonMatch[0]);
  } catch {
    return await ghost.chat(userMessage);
  }

  let agentResults = [];
  let toolResults = [];

  if (plan.tools && plan.tools.length > 0) {
    for (const toolCall of plan.tools) {
      try {
        const tool = GhostTools[toolCall.tool];
        if (tool) {
          const result = await tool.execute(toolCall.query || toolCall.url || toolCall.city);
          toolResults.push({ tool: toolCall.tool, result });
        }
      } catch (err) {
        toolResults.push({ tool: toolCall.tool, error: err.message });
      }
    }
  }

  if (plan.agents && plan.agents.length > 0) {
    for (const agentDef of plan.agents) {
      const agent = await ghost.spawnAgent(agentDef.name, agentDef.specialty, agentDef.task);
      const agentResponse = await ghost.chatWithAgent(agent.id, agentDef.task);
      agentResults.push({ agent: agentDef.name, result: agentResponse });
    }
  }

  if (agentResults.length > 0 || toolResults.length > 0) {
    const synthesisMessages = [
      { role: 'system', content: 'You are GHOST. Synthesize results into a clear, concise response.' },
      { role: 'user', content: `Request: ${userMessage}\nAgent results: ${JSON.stringify(agentResults)}\nTool results: ${JSON.stringify(toolResults)}\nGive final answer.` }
    ];
    const finalResponse = await ghost.queryLLM(synthesisMessages);
    ghost.conversationHistory.push(
      { role: 'user', content: userMessage },
      { role: 'assistant', content: finalResponse }
    );
    return { response: finalResponse, agentsSpawned: agentResults.map(a => a.agent), toolsUsed: toolResults.map(t => t.tool) };
  }

  return { response: plan.response, agentsSpawned: [], toolsUsed: [] };
}

module.exports = { runAutoAgent };

const Groq = require("groq-sdk");
const fs = require("fs");
const path = require("path");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Auto-load all agents
function loadAllAgents() {
  const agents = {};
  const dir = path.join(__dirname);
  fs.readdirSync(dir).forEach(f => {
    if (f === 'orchestrator.js' || !f.endsWith('.js')) return;
    try {
      const mod = require(path.join(dir, f));
      const name = f.replace('.js','');
      agents[name] = mod;
    } catch(e) {}
  });
  return agents;
}

class OrchestratorAgent {
  constructor() {
    this.agents = loadAllAgents();
    this.agentRegistry = {};
  }

  getAgentList() {
    return Object.keys(this.agents).map(name => {
      const a = this.agents[name];
      const methods = Object.keys(a).filter(k => typeof a[k] === 'function' || (a[k] && typeof a[k].run === 'function'));
      return `- ${name}: ${methods.join(', ')}`;
    }).join('\n');
  }

  async run(task, maxLoops = 10) {
    let loop = 0;
    let context = [];
    let finalResult = null;

    while (loop < maxLoops) {
      loop++;
      const evaluation = await this.evaluate(task, context, loop);
      if (evaluation.done) { finalResult = evaluation.answer; break; }
      const steps = evaluation.steps || [];
      const results = await this.executeSteps(steps, context);
      context.push(...results);
    }

    if (!finalResult) finalResult = await this.summarize(task, context);
    return { result: finalResult, loops: loop, steps: context.length };
  }

  async evaluate(task, context, loop) {
    const agentList = this.getAgentList();
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are Ghost's autonomous brain. You control all agents independently.
Available agents:\n${agentList}

Respond ONLY with JSON:
- If task complete: {"done":true,"answer":"final answer"}
- If needs work: {"done":false,"steps":[{"agent":"agentName","method":"methodName","args":{"key":"val"},"parallel":true}]}

Rules:
- Pick the best agent for each subtask
- Run independent tasks in parallel (parallel:true)
- Run dependent tasks sequentially (parallel:false)
- Be decisive — Ghost acts, not asks`
        },
        {
          role: "user",
          content: `Task: ${task}\nLoop: ${loop}\nContext:\n${JSON.stringify(context.slice(-6), null, 2)}`
        }
      ],
      temperature: 0.2,
      max_tokens: 512
    });
    try {
      return JSON.parse(res.choices[0].message.content.replace(/```json|```/g, "").trim());
    } catch {
      return { done: false, steps: [{ agent: "webAgent", method: "searchWeb", args: { query: task }, parallel: false }] };
    }
  }

  async executeSteps(steps, context) {
    const parallel = steps.filter(s => s.parallel !== false);
    const sequential = steps.filter(s => s.parallel === false);
    const results = [];

    if (parallel.length) {
      const pr = await Promise.all(parallel.map(s => this.runStep(s, context)));
      results.push(...pr);
    }
    for (const s of sequential) {
      results.push(await this.runStep(s, [...context, ...results]));
    }
    return results;
  }

  async runStep(step, context) {
    const agent = this.agents[step.agent];
    if (!agent) return { step: step.agent, result: { error: `Agent '${step.agent}' not found` } };
    try {
      const method = step.method || 'run';
      const fn = agent[method] || agent.run;
      if (!fn) return { step: step.agent, result: { error: `Method '${method}' not found` } };
      const args = step.args || {};
      // Support both run(task, context) and run(args) patterns
      const result = typeof fn === 'function'
        ? await fn(Object.values(args)[0] || JSON.stringify(args), context)
        : null;
      return { step: step.agent+'.'+method, agent: step.agent, result };
    } catch(e) {
      return { step: step.agent, result: { error: e.message } };
    }
  }

  async summarize(task, context) {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "You are Ghost. Give a clear, direct final answer. No fluff." },
        { role: "user", content: `Task: ${task}\n\nResults:\n${JSON.stringify(context, null, 2)}` }
      ],
      max_tokens: 1024
    });
    return res.choices[0].message.content;
  }

  async createAgent(name, instructions) {
    this.agentRegistry[name] = { instructions, created: Date.now() };
    this.agents[name] = {
      run: async (task) => {
        const res = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "system", content: instructions }, { role: "user", content: task }],
        });
        return { result: res.choices[0].message.content };
      }
    };
    return { success: true, agent: name };
  }
}

module.exports = OrchestratorAgent;

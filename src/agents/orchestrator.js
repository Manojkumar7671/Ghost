const Groq = require("groq-sdk");
const CodeAgent = require("./codeAgent");
const BrowserAgent = require("./browserAgent");
const FileAgent = require("./fileAgent");
const MemoryAgent = require("./memoryAgent");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class OrchestratorAgent {
  constructor() {
    this.memory = new MemoryAgent();
    this.agents = {
      code: new CodeAgent(),
      browser: new BrowserAgent(),
      file: new FileAgent(),
      memory: this.memory,
    };
  }

  async run(task) {
    this.memory.addHistory("user", task);
    const history = this.memory.getHistory(10);
    const memoryList = this.memory.list().slice(0, 10);
    const memoryContext = memoryList.length ? `\nStored memory:\n${JSON.stringify(memoryList)}` : "";
    const plan = await this.plan(task, history, memoryContext);
    const results = await this.executeParallel(plan.steps);
    const summary = await this.summarize(task, results);
    this.memory.addHistory("assistant", summary);
    return summary;
  }

  async executeParallel(steps) {
    const results = [];
    const parallelSteps = steps.filter(s => !s.depends_on);
    const sequentialSteps = steps.filter(s => s.depends_on);

    if (parallelSteps.length) {
      const parallelResults = await Promise.all(
        parallelSteps.map(async (step) => {
          const agent = this.agents[step.agent];
          if (!agent) return { step: step.task, result: "Unknown agent" };
          const result = await agent.run(step.task, results);
          return { step: step.task, agent: step.agent, result };
        })
      );
      results.push(...parallelResults);
    }

    for (const step of sequentialSteps) {
      const agent = this.agents[step.agent];
      if (!agent) { results.push({ step: step.task, result: "Unknown agent" }); continue; }
      const result = await agent.run(step.task, results);
      results.push({ step: step.task, agent: step.agent, result });
    }

    return results;
  }

  async plan(task, history = [], memoryContext = "") {
    const historyStr = history.map(h => `${h.role}: ${h.content}`).join("\n");
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are a task planner. Agents: browser, code, file, memory.
Respond ONLY with JSON: {"steps":[{"agent":"browser"|"code"|"file"|"memory","task":"...","depends_on":null|0}]}
Independent steps: depends_on=null. Steps needing previous results: depends_on=step_index.${memoryContext}`
        },
        { role: "user", content: `History:\n${historyStr}\n\nTask: ${task}` }
      ],
      temperature: 0.2,
    });
    try {
      return JSON.parse(res.choices[0].message.content.replace(/```json|```/g, "").trim());
    } catch {
      return { steps: [{ agent: "browser", task, depends_on: null }] };
    }
  }

  async summarize(originalTask, results) {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "You are Ghost. Summarize results clearly and concisely. Be direct." },
        { role: "user", content: `Task: ${originalTask}\n\nResults:\n${JSON.stringify(results, null, 2)}` }
      ],
    });
    return res.choices[0].message.content;
  }
}

module.exports = OrchestratorAgent;
EOFcat > ~/Ghost/src/agents/orchestrator.js << 'EOF'
const Groq = require("groq-sdk");
const CodeAgent = require("./codeAgent");
const BrowserAgent = require("./browserAgent");
const FileAgent = require("./fileAgent");
const MemoryAgent = require("./memoryAgent");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class OrchestratorAgent {
  constructor() {
    this.memory = new MemoryAgent();
    this.agents = {
      code: new CodeAgent(),
      browser: new BrowserAgent(),
      file: new FileAgent(),
      memory: this.memory,
    };
  }

  async run(task) {
    this.memory.addHistory("user", task);
    const history = this.memory.getHistory(10);
    const memoryList = this.memory.list().slice(0, 10);
    const memoryContext = memoryList.length ? `\nStored memory:\n${JSON.stringify(memoryList)}` : "";
    const plan = await this.plan(task, history, memoryContext);
    const results = await this.executeParallel(plan.steps);
    const summary = await this.summarize(task, results);
    this.memory.addHistory("assistant", summary);
    return summary;
  }

  async executeParallel(steps) {
    const results = [];
    const parallelSteps = steps.filter(s => !s.depends_on);
    const sequentialSteps = steps.filter(s => s.depends_on);

    if (parallelSteps.length) {
      const parallelResults = await Promise.all(
        parallelSteps.map(async (step) => {
          const agent = this.agents[step.agent];
          if (!agent) return { step: step.task, result: "Unknown agent" };
          const result = await agent.run(step.task, results);
          return { step: step.task, agent: step.agent, result };
        })
      );
      results.push(...parallelResults);
    }

    for (const step of sequentialSteps) {
      const agent = this.agents[step.agent];
      if (!agent) { results.push({ step: step.task, result: "Unknown agent" }); continue; }
      const result = await agent.run(step.task, results);
      results.push({ step: step.task, agent: step.agent, result });
    }

    return results;
  }

  async plan(task, history = [], memoryContext = "") {
    const historyStr = history.map(h => `${h.role}: ${h.content}`).join("\n");
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are a task planner. Agents: browser, code, file, memory.
Respond ONLY with JSON: {"steps":[{"agent":"browser"|"code"|"file"|"memory","task":"...","depends_on":null|0}]}
Independent steps: depends_on=null. Steps needing previous results: depends_on=step_index.${memoryContext}`
        },
        { role: "user", content: `History:\n${historyStr}\n\nTask: ${task}` }
      ],
      temperature: 0.2,
    });
    try {
      return JSON.parse(res.choices[0].message.content.replace(/```json|```/g, "").trim());
    } catch {
      return { steps: [{ agent: "browser", task, depends_on: null }] };
    }
  }

  async summarize(originalTask, results) {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "You are Ghost. Summarize results clearly and concisely. Be direct." },
        { role: "user", content: `Task: ${originalTask}\n\nResults:\n${JSON.stringify(results, null, 2)}` }
      ],
    });
    return res.choices[0].message.content;
  }
}

module.exports = OrchestratorAgent;

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
    this.agentRegistry = {};
  }

  async run(task, maxLoops = 8) {
    this.memory.addHistory("user", task);
    let loop = 0;
    let context = [];
    let finalResult = null;

    while (loop < maxLoops) {
      loop++;
      const evaluation = await this.evaluate(task, context, loop);

      if (evaluation.done) {
        finalResult = evaluation.answer;
        break;
      }

      const steps = evaluation.steps || [];
      const results = await this.executeParallel(steps, context);
      context.push(...results);

      const failed = results.filter(r => r.result?.success === false || r.result?.error);
      if (failed.length && loop < maxLoops) continue;
    }

    if (!finalResult) {
      finalResult = await this.summarize(task, context);
    }

    this.memory.addHistory("assistant", finalResult);
    return { result: finalResult, loops: loop, steps: context.length };
  }

  async evaluate(task, context, loop) {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are Ghost's brain. Evaluate if the task is complete or needs more steps.
Agents available: browser (web search), code (run python/js code), file (read/write files), memory (store info).
Respond ONLY with JSON:
- If done: {"done":true,"answer":"final answer here"}
- If needs more work: {"done":false,"steps":[{"agent":"browser"|"code"|"file"|"memory","task":"...","parallel":true|false}]}
Be aggressive - keep trying different approaches until the task is truly complete.`
        },
        {
          role: "user",
          content: `Task: ${task}\nLoop: ${loop}\nContext so far:\n${JSON.stringify(context.slice(-6), null, 2)}`
        }
      ],
      temperature: 0.2,
    });
    try {
      return JSON.parse(res.choices[0].message.content.replace(/```json|```/g, "").trim());
    } catch {
      return { done: false, steps: [{ agent: "browser", task, parallel: false }] };
    }
  }

  async executeParallel(steps, context) {
    const parallel = steps.filter(s => s.parallel !== false);
    const sequential = steps.filter(s => s.parallel === false);
    const results = [];

    if (parallel.length) {
      const pr = await Promise.all(parallel.map(async (step) => {
        const agent = this.agents[step.agent];
        if (!agent) return { step: step.task, agent: step.agent, result: { error: "Unknown agent" } };
        const result = await agent.run(step.task, context);
        return { step: step.task, agent: step.agent, result };
      }));
      results.push(...pr);
    }

    for (const step of sequential) {
      const agent = this.agents[step.agent];
      if (!agent) { results.push({ step: step.task, result: { error: "Unknown agent" } }); continue; }
      const result = await agent.run(step.task, [...context, ...results]);
      results.push({ step: step.task, agent: step.agent, result });
    }

    return results;
  }

  async summarize(task, context) {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "You are Ghost. Give a clear, direct final answer based on all work done." },
        { role: "user", content: `Task: ${task}\n\nAll results:\n${JSON.stringify(context, null, 2)}` }
      ],
    });
    return res.choices[0].message.content;
  }

  async createAgent(name, instructions) {
    this.agentRegistry[name] = { instructions, created: Date.now() };
    this.agents[name] = {
      run: async (task, context) => {
        const res = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: instructions },
            { role: "user", content: task }
          ],
        });
        return { result: res.choices[0].message.content };
      }
    };
    return { success: true, agent: name };
  }
}

module.exports = OrchestratorAgent;

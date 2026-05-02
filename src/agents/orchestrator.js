const Groq = require("groq-sdk");
const CodeAgent = require("./codeAgent");
const BrowserAgent = require("./browserAgent");
const FileAgent = require("./fileAgent");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class OrchestratorAgent {
  constructor() {
    this.agents = { code: new CodeAgent(), browser: new BrowserAgent(), file: new FileAgent() };
  }
  async run(task) {
    const plan = await this.plan(task);
    const results = [];
    for (const step of plan.steps) {
      const agent = this.agents[step.agent];
      if (!agent) { results.push({ step: step.task, result: "Unknown agent" }); continue; }
      const result = await agent.run(step.task, results);
      results.push({ step: step.task, agent: step.agent, result });
    }
    return await this.summarize(task, results);
  }
  async plan(task) {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "Respond ONLY with JSON: {steps:[{agent:'browser'|'code'|'file',task:'...'}]}" },
        { role: "user", content: task }
      ],
      temperature: 0.3,
    });
    try { return JSON.parse(res.choices[0].message.content.replace(/```json|```/g, "").trim()); }
    catch { return { steps: [{ agent: "code", task }] }; }
  }
  async summarize(originalTask, results) {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "Summarize the results clearly." },
        { role: "user", content: "Task: " + originalTask + "\n\nResults:\n" + JSON.stringify(results, null, 2) }
      ],
    });
    return res.choices[0].message.content;
  }
}
module.exports = OrchestratorAgent;

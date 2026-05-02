const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");
const OrchestratorAgent = require("./agents/orchestrator");
const MemoryAgent = require("./agents/memoryAgent");

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const orchestrator = new OrchestratorAgent();
const memory = new MemoryAgent();

app.get("/", (req, res) => {
  res.json({ status: "Ghost is alive", version: "4.0", mode: "autonomous" });
});

app.post("/chat", async (req, res) => {
  const { message, use_history = true } = req.body;
  if (!message) return res.status(400).json({ error: "No message" });
  try {
    const history = use_history ? memory.getHistory(20) : [];
    const messages = [
      { role: "system", content: "You are Ghost, a powerful autonomous AI. Be direct and effective." },
      ...history,
      { role: "user", content: message },
    ];
    const r = await groq.chat.completions.create({ model: "llama-3.3-70b-versatile", messages });
    const reply = r.choices[0].message.content;
    memory.addHistory("user", message);
    memory.addHistory("assistant", reply);
    res.json({ reply });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/agent", async (req, res) => {
  const { task } = req.body;
  if (!task) return res.status(400).json({ error: "No task" });
  try {
    const result = await orchestrator.run(task);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/agent/create", async (req, res) => {
  const { name, instructions } = req.body;
  if (!name || !instructions) return res.status(400).json({ error: "name and instructions required" });
  try {
    const result = await orchestrator.createAgent(name, instructions);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/agents", (req, res) => {
  res.json({ agents: Object.keys(orchestrator.agents), custom: orchestrator.agentRegistry });
});

app.get("/memory", (req, res) => {
  res.json({ memories: memory.list(), history: memory.getHistory(20) });
});
app.post("/memory", (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) return res.status(400).json({ error: "key and value required" });
  res.json(memory.set(key, value));
});
app.delete("/memory", (req, res) => {
  memory.clearHistory();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Ghost v4 autonomous running on port ${PORT}`));

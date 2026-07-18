# Session Developer Notes — Google Antigravity & Master Manoj

**Date:** July 18, 2026
**Topic:** Ghost AI Codebase Audit, Security Optimization, and Architecture Roadmap

---

## 🛠️ Changes Implemented in `server.js`

We audited the core server logic and applied critical fixes directly to the local project files:

1. **Express Route Collision Fix:**
   * Moved `app.use('/api/pipeline', createPipelineRoutes(n8nMcpClient))` *above* the dummy `/api/pipeline/execute` POST endpoint. This ensures that the pipeline router intercepts real pipeline calls instead of being blocked by the placeholder route.
2. **Race Condition Prevention in Python execution:**
   * Swapped out the static `/ghost_payload.py` temp file with a dynamically generated UUID name: `ghost_${crypto.randomUUID()}.py`. This prevents concurrent user chat requests from overwriting each other's execution script and crashing the Node runner.
3. **LLM Matrix Gateway Resilience:**
   * Added `res.ok` validation inside `callLLM()` immediately after fetch calls. If an API key is rate-limited or a node goes offline, the fallback catch immediately triggers and tries the next matrix node without throwing unhandled TypeErrors.
4. **Denial-of-Service (DoS) Protection:**
   * Lowered the default Express JSON payload limits from `50mb` to `10mb` to protect system memory limits from malicious payload floods.

---

## 🔮 Future Architecture Roadmap for Ghost

To bring Ghost up to the standard of high-end autonomous developer agents like Claude Code or Antigravity, we have mapped out these planned upgrades:

1. **Secure Execution Sandboxes:**
   * Replace host-level `execSync` execution with a containerized Docker environment or WebAssembly runtime (like Pyodide) to isolate script executions from host secrets (`JWT_SECRET`, `SUPABASE_DB_URL`, etc.).
2. **Standardized Model Context Protocol (MCP) Hub:**
   * Integrate an MCP client that loads community `.json` servers to dynamically hook Ghost to third-party tools (Postgres, Slack, Gmail) without custom API code.
3. **Visual Browser Integration:**
   * Enable periodic screenshot captures in `webAgent` (using Playwright/Puppeteer) to render what the agent is browsing live in the `ghost.html` UI panel.
4. **Dynamic DAG Pipeline Compiler:**
   * Let the main LLM brain compile complex commands directly into DAG graphs, executing them via `runPipeline.js` for input-output validation and human approval gate states.

---

*Saved locally in Ghost workspace via Google Antigravity.*

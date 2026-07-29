# Ghost Component Confidence & Trust Status Matrix

This document provides a realistic, unvarnished classification of the confidence level for every write-capable, autonomous, or system-interacting component in Ghost.

---

## Confidence Level Definitions

* **`demo-tested`**: Functional proof-of-concept; verified working in basic single-user scenarios, but lacks extensive real-world failure testing, load stress, or prolonged unattended operation.
* **`stress-tested`**: Verified under adversarial inputs, concurrent queries, rate limits, or process crash scenarios; edge cases have been identified and patched.
* **`production-trusted`**: Battle-tested over thousands of unattended operational hours with zero security breaches, full audit logs, and complete crash isolation. *(No component is currently marked at this level).*

---

## System Component Confidence Matrix

| Component | Write / System Scope | Current Confidence Level | Tested Boundaries & Residual Risks |
| :--- | :--- | :--- | :--- |
| **Workspace Tools** (`src/tools/workspaceTools.js`) | Reads/writes files in workspace; runs shell commands via `child_process.exec`. | **`stress-tested`** | Verified path traversal block (`resolveSafePath`), secret output stream redaction, and `isRiskyAction` confirmation intercepts. *Residual risk: complex obfuscated multi-stage shell scripts.* |
| **LLM Router** (`llmRouter.js`) | Outbound HTTPS API requests to 5+ LLM providers; fallback cascade handling. | **`stress-tested`** | Verified automatic key failover, provider rate-limit recovery (HTTP 429), and stream-level log secret redaction (`secretHook`). *Residual risk: vendor API downtime on all 5 providers simultaneously.* |
| **Security Gates** (`middleware/security.js` & `services/commandGate.js`) | Express input sanitization; JWT token checks (`requireAdminToken`); prompt injection filtering. | **`stress-tested`** | Verified XSS stripping, prompt injection pattern matching, and rate limiting (20 req/min). *Residual risk: novel zero-day prompt injection structures.* |
| **Memory System** (`src/tools/memory.js`) | Writes local JSON history files (`chat_history_*.json`) and vector store embeddings. | **`stress-tested`** | Verified message truncation (`10,000` char cap) to prevent context-poisoning DoS, and concurrent admin/guest isolation. *Residual risk: large volume unindexed vector search latency.* |
| **Autonomous Loop** (`services/autonomousLoop.js`) | Multi-step self-directed task execution and verification. | **`stress-tested`** | Verified mid-step crash resumption (skipping completed steps without state duplication or corrupt file writes) and vague/destructive prompt execution halting (`awaiting_approval`). *Residual risk: multi-day long-running unattended task loops.* |
| **Local Control Daemon** (`services/localControlServer.js`) | macOS `osascript` application launching, URL opening, and local script execution. | **`stress-tested`** | Verified deployment mode gate (`public` restriction), session token upgrade auth, 12 back-to-back command executions, malformed payload safety, and path traversal rejection (`16/16 PASSED`). *Residual risk: OS-level UI automation permission changes by macOS.* |
| **Workflow / Plugin System** (`services/workflowEngine.js` & `n8n`) | Executes n8n sidecar automation workflows and dynamic plugin routes. | **`demo-tested`** | Basic invocation verified; relies on external n8n process stability and SQLite database permissions. |
| **Google Direct OAuth Agent** (`src/agents/googleAgent.js`) | Reads/writes Gmail, Google Calendar, and Google Sheets via OAuth tokens. | **`demo-tested`** | OAuth flow and basic API endpoints verified; requires token refresh edge-case testing under expired session states. |
| **Notion Agent** (`src/agents/notionAgent.js`) | Reads/creates Notion database pages via Notion API token. | **`demo-tested`** | Basic page search and creation verified; lacks error recovery for missing Notion workspace permissions. |
| **GitHub Agent** (`src/agents/githubAgent.js`) | Lists repos, analyzes code trees, and pushes file updates to GitHub. | **`demo-tested`** | Basic file push verified; needs branch protection and conflict resolution validation. |

---

## Maintainer Commitment

This document must be updated whenever a component undergoes significant stress testing or architectural refactoring. No component shall be upgraded to `production-trusted` without multi-day uninterrupted unattended operation logs.

# Ghost System Architecture & Technical Specifications

This document outlines the system topology, permission boundaries, failure modes, and security architecture of the Ghost AI platform running locally on macOS.

---

## 1. System Topology & Core Components

```
                      +-----------------------------+
                      |    Electron Desktop UI      |
                      |  (HTML5 / CSS / Three.js)   |
                      +--------------+--------------+
                                     | (HTTP/WS)
                                     v
                      +-----------------------------+
                      |      Express Server         |
                      |        (server.js)          |
                      +--------------+--------------+
                                     |
       +-----------------------------+-----------------------------+
       |                             |                             |
       v                             v                             v
+--------------+              +--------------+              +--------------+
|  LLM Router  |              |  Brain Core  |              | Local Daemon |
| (llmRouter)  |              | (src/brain)  |              | (localControl|
+--------------+              +--------------+              +--------------+
       |                             |                             |
  Multi-LLM                   Tool Execution              macOS Native IPC
 (NVIDIA/Groq/             (Filesystem/Database/          (System Control /
 OpenRouter/Gemini)         Workspace Tools)              Automation)
```

---

## 2. Component Specifications

### 1. Unified Express Server (`server.js`)
* **Role**: Primary entry point handling REST endpoints (`/api/chat`, `/api/execute-action`), authentication cookies, static UI delivery, and web security.
* **Permissions & Access**:
  * Read/Write access to project root directory.
  * Access to `.env` configuration keys.
  * Full HTTP access for client connections on `http://localhost:3000`.
* **Security & Isolation**:
  * Enforces `securityMiddleware` to reject XSS patterns and rapid prompt injection structures.
  * Uses `chatLimiter` to cap requests at 20 queries/min per IP.
  * Applies `requireAdminToken` JWT checks for administrative operations (`/api/execute-action`, `/api/modes/activate`).
* **Failure / Compromise Mode**:
  * *Failure*: Server shuts down; desktop app displays connection lost state. PM2 daemon restarts automatically.
  * *Compromise*: If an attacker gains unauthenticated RCE on `server.js`, they gain guest file execution capability. Mitigated by `GHOST_DEPLOYMENT_MODE=public` which disables admin execution routes.

---

### 2. Multi-Provider LLM Router (`llmRouter.js`)
* **Role**: Manages multi-model intelligence fallback loops across Groq, NVIDIA NIM, Gemini, OpenRouter, and FreeLLMAPI.
* **Permissions & Access**:
  * Outbound HTTPS fetch access to external LLM provider endpoints.
  * Access to API keys (`GROQ_API_KEY`, `NVIDIA_API_KEY`, etc.).
* **Security & Redaction**:
  * Implements `isValidKey` hash verification to bypass non-functional keys.
  * Passes all error outputs and fallback logs through `redactSecrets` to ensure API keys are never printed in cleartext terminal output.
* **Failure / Compromise Mode**:
  * *Failure*: Automatically cascades to the next available provider. If all fail, returns a clean error without crashing Node.
  * *Compromise*: Compromise of an API key allows API usage; secrets are redacted in output logs to prevent exfiltration.

---

### 3. Ghost Brain Engine (`src/brain.js`)
* **Role**: Evaluates user intent, builds execution plans, routes actions to specific tools, and formats response summaries.
* **Permissions & Access**:
  * Orchestrates tool calls (`workspace_view_file`, `workspace_edit_file`, `workspace_run_command`, `database_query`, `memory_save`).
* **Security & Safeguards**:
  * **Input Isolation**: Wraps tool outputs in untrusted data delimiters before LLM summary steps to prevent indirect prompt injection.
  * **Gentle Safety Checks**: Intercepts destructive command patterns (`rm`, `mv`, `cp`, `chmod`, `delete`) via `isRiskyAction` and prompts for user confirmation before proceeding.
* **Failure / Compromise Mode**:
  * *Failure*: Falls back to direct plain-text response mode if planning fails.
  * *Compromise*: Intent manipulation is blocked from executing destructive system mutations without explicit user confirmation.

---

### 4. Workspace Tools (`src/tools/workspaceTools.js`)
* **Role**: Executes file inspection, safe search-and-replace edits, and local shell command execution within the project directory.
* **Permissions & Access**:
  * Local filesystem read/write access.
  * Command execution via `child_process.exec`.
* **Security & Isolation**:
  * **Path Traversal Shield**: `resolveSafePath` resolves absolute paths and enforces directory boundary checks outside project root.
  * **Command Gate & Blocklist**: Enforces `commandGate.js` and `securityMonitor.js` to block `sudo`, `rm -rf /`, `chown`, and reverse shell patterns.
  * **Output Redaction**: Filters `stdout` and `stderr` through `redactSecrets`.
* **Failure / Compromise Mode**:
  * *Failure*: Returns standard JSON error payload without terminating the Express process.
  * *Compromise*: Path traversal logic prevents modifications outside the workspace.

---

### 5. Local Control Daemon (`services/localControlServer.js`)
* **Role**: Provides macOS desktop automation (opening applications, URLs, local script execution).
* **Permissions & Access**:
  * macOS `osascript` / `open` system execution.
  * WebSocket server on port `3000`.
* **Security & Isolation**:
  * Requires valid JWT session cookie for WebSocket handshake upgrades.
  * Gated behind `isPublic` check (disabled when running in public mode).
* **Failure / Compromise Mode**:
  * *Failure*: Desktop automation actions fail with an error log. Express server remains operational.

---

### 6. Memory System (`src/tools/memory.js` & `memory/`)
* **Role**: Manages short-term chat history (`chat_history_*.json`) and long-term vector embeddings (`vector_store.json`).
* **Permissions & Access**:
  * Read/Write access to `./memory/` directory.
* **Security & Isolation**:
  * **Context-Poisoning Protection**: Automatically truncates stored historical messages to a max length of `10,000` characters to prevent context-bloat DoS attacks.
  * **User Isolation**: Separates history files per user context (`chat_history_guest.json`, `chat_history_master_manoj.json`).
* **Failure / Compromise Mode**:
  * *Failure*: Falls back to empty history array; vector store rebuilds gracefully.

---

## 3. Standing Security Rules for Maintainers

1. **Secret Redaction**: Never `console.log`, `echo`, or print raw secret keys or tokens. All outputs must be wrapped in `redactSecrets()`. Secrets must be written directly to `.env`.
2. **Proportional Self-Audit**: Every new tool or security update must be verified with a targeted self-audit before declaring the change complete.

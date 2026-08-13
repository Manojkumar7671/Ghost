# 🏛️ Ghost System Architecture & Deep Dive

This document details the architectural design, control flow, security boundaries, and execution models of the **Ghost Autonomous AI Platform**.

---

## 1. DAG Pipeline Engine Flow

Ghost processes user intent through a directed acyclic graph (DAG) execution engine ([`services/workflowEngine.js`](file:///Users/manojkumarmathangi/Ghost/services/workflowEngine.js) & [`services/intentPlanner.js`](file:///Users/manojkumarmathangi/Ghost/services/intentPlanner.js)).

```text
[ User Prompt / Voice Request ]
              │
              ▼
    [ Task Understanding ]
  (Classify complexity & intent)
              │
              ▼
     [ DAG Plan Builder ]
(Deconstruct into ordered steps)
              │
              ├── Step 1: Code / Tool Execution  ──► [ Gondolin Micro-VM ]
              │                                                │
              ├── Step 2: RAG Context Retrieval   ──► [ Turbovec SIMD Index ]
              │                                                │
              └── Step 3: Desktop State Action    ──► [ HITL Nonce Gate ]
                                                               │
                                                               ▼
                                                  [ Execution Summary & Output ]
```

### Plan Generation & Step Verification
1. **Intent Analysis**: Classifies incoming tasks as `simple_query`, `code_execution`, `desktop_action`, or `multi_step_workflow`.
2. **DAG Construction**: Generates an array of explicit task steps with dependencies and verification checks.
3. **Sequential Execution**: Steps are executed sequentially. If a step fails, the system enters an error recovery loop or escalates to human confirmation.

---

## 2. Multi-Provider LLM Routing Logic

Ghost uses an active fallback router ([`llmRouter.js`](file:///Users/manojkumarmathangi/Ghost/llmRouter.js)) to eliminate single-point-of-failure risks and ensure low-latency completions.

```text
                        ┌───────────────────────────────┐
                        │   Incoming LLM Request        │
                        └───────────────┬───────────────┘
                                        │
                                        ▼
                         Attempt 1: FreeLLMAPI / Local
                                (Fastest local check)
                                        │ (If failed / timeout)
                                        ▼
                         Attempt 2: NVIDIA NIM
                  (meta/llama-3.1-8b-instruct ~500ms)
                                        │ (If rate-limited / error)
                                        ▼
                         Attempt 3: Google Gemini Pro
                         (gemini-1.5-pro / 2.0-flash)
                                        │ (If fallback required)
                                        ▼
                         Attempt 4: Groq / OpenRouter
                    (llama-3.3-70b-versatile / DeepSeek)
```

- **Health Checks & Telemetry**: Every provider attempt logs latency (`served by NVIDIA NIM in 579ms`). If a provider fails, fallback occurs seamlessly in under 30ms.

---

## 3. Human-in-the-Loop (HITL) Nonce Gate

To prevent unauthorized file modifications or desktop commands, Ghost implements a cryptographically enforced approval gate ([`state/pendingActions.js`](file:///Users/manojkumarmathangi/Ghost/state/pendingActions.js)).

### Security Lifecycle:
1. **Action Generation**: When Ghost proposes a high-risk action (e.g. desktop overlay command, persistent code write, external deployment), a 16-byte random hexadecimal nonce is generated:
   ```javascript
   const actionId = crypto.randomBytes(16).toString('hex');
   ```
2. **State Register**: The action payload, timestamp, and 5-minute expiration window are stored in `pendingActions`.
3. **Execution Block**: The system returns `actionRequired: true` and `actionId` to the UI or client.
4. **Consumption**: Execution is only triggered when the user explicitly sends `POST /api/execute-action` with the exact `actionId`. The nonce is immediately deleted upon consumption, preventing replay attacks.

---

## 4. Micro-VM Sandbox Isolation (Gondolin)

Ghost isolates code execution using Gondolin micro-VM sandboxing ([`services/pythonSandbox.js`](file:///Users/manojkumarmathangi/Ghost/services/pythonSandbox.js) & `~/.pi/agent/extensions/gondolin`).

### Isolation Mechanisms:
- **Path Mapping**: Guest path translation maps workspace directories to `/workspace`.
- **Out-of-Bounds Interception**: Attempts to read or write host files outside the active workspace (e.g., `/etc/passwd`, `~/.zshrc`) are intercepted by Gondolin hooks.
- **Explicit Security Alert Logs**:
  ```text
  [GONDOLIN_SANDBOX_INTERCEPT] Intercepted access attempt to host path: /etc/passwd
  [GONDOLIN_SANDBOX_BLOCKED] Operation denied by micro-VM boundary.
  ```
- **OS Resource Quotas**: Python processes are launched with 20-second wall-clock limits and 1GB memory bounds.

---

## 5. Synthflow MCP Self-Hosted Integration

Voice capabilities are powered by a self-hosted Synthflow MCP server running under PM2 (`http://localhost:3099/sse`).

- **Protocol**: Model Context Protocol (MCP) over Server-Sent Events (SSE).
- **Capabilities**: 53 registered voice agent tools (`create_agent`, `start_call`, `get_telephony_number`).
- **Bridge Fallback**: [`services/synthflowBridge.js`](file:///Users/manojkumarmathangi/Ghost/services/synthflowBridge.js) automatically handles real API keys when present, and returns clear MVP stubs (`AGENT_CREATED_MOCK`) when keys are unconfigured.

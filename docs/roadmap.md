# Ghost AI: Self-Optimizing Multi-Agent Architecture Roadmap

This document outlines the architectural blueprint for the next phase of Ghost AI, as aligned during the developer design session on July 18, 2026.

---

## 🏗️ System Architecture Overview

```mermaid
graph TD
    User([User Request]) --> Brain[Planning Brain]
    Brain --> Orch[Orchestrator]
    
    subgraph Message Broker (Supabase Pub/Sub)
        Orch -->|Publish Task| Channel[DB Event Channel]
        AgentA[Agent: Coder] <--> Channel
        AgentB[Agent: Tester] <--> Channel
    end
    
    subgraph Data Store
        Channel <--> DB[(Supabase Postgres)]
        DB <--> LearnStore[Learning & Rules Store]
    end
    
    subgraph Self-Optimizing Feedback Loop
        DB -->|Execution Traces| Critic[Background Evaluator Agent]
        Critic -->|Generate Optimization Rules| LearnStore
        LearnStore -->|Dynamic Prompt Injections| Orch
    end
```

---

## 🗺️ Execution Roadmap

### Phase 1: Shared Database & Pub/Sub Channels (Database Layer)
* **Goal:** Migrate dynamic agent memory and logs from flat files to a central **Supabase PostgreSQL** database.
* **Details:**
  * Create `memory_logs` and `agent_states` tables in Supabase.
  * Implement an event-driven subscriber model where subagents poll or listen to database event changes, allowing them to collaborate asynchronously on different parts of a complex workflow.

### Phase 2: Dynamic Prompt Optimization (Self-Learning Loop)
* **Goal:** Implement the auto-improvement RLAIF (Reinforcement Learning from AI Feedback) system.
* **Details:**
  * **The Evaluator Agent:** Create a background cron-job agent that parses successful and failed task logs in `memory_logs`.
  * **Rule Compilation:** If a task succeeds, it distills the successful strategy into a JSON rule (e.g. *"When writing python tests, always import unittest"*). If it fails, it compiles a "trap to avoid".
  * **Dynamic Injection:** Modify the orchestrator prompt compiler to pull these rules matching the current task keyword and append them to the system prompt of the executing subagents.

### Phase 3: Cloud Sandboxing (Containerized Execution)
* **Goal:** Secure the code execution environment for cloud scale.
* **Details:**
  * Replace the local Node child process runtime with disposable cloud containers (e.g. Docker SDK or WebAssembly Pyodide runtimes) to completely isolate user-requested code from the server secrets.

---

*Compiled and aligned via Google Antigravity & Master Manoj.*

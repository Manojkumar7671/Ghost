# 🧪 Ghost Empirical Benchmark Suite & Real Proof-of-Work

Ghost includes an automated benchmark suite in [`benchmarks/`](./benchmarks) that tests reasoning quality, agent tool execution, coding issue resolution, and system integration.

---

## Benchmark Suite Overview

| Benchmark Suite | Script Path | Tasks | Pass Rate | Execution Mode |
| :--- | :--- | :--- | :--- | :--- |
| **Head-to-Head Reasoner** | `benchmarks/head_to_head_benchmark.cjs` | 15 Prompts | **15 / 15 (100%)** | Real Network |
| **Agent Tool-Use** | `benchmarks/agent_benchmark.cjs` | 8 Tasks | **7 / 8 (87.5%)** | Real Network |
| **Coding GitHub Issues** | `benchmarks/coding_benchmark.cjs` | 10 Repos | **3 / 10 (30.0%)** | Sandboxed Micro-VM |
| **Integration Suite** | `benchmarks/integration_benchmark.cjs` | 3 Subsystems | **3 / 3 (100%)** | Local & API Bridge |

---

## 1. Head-to-Head Reasoner Benchmark (`15/15`)

Tests complex reasoning, math logic, algorithm design, and structured prose generation across 15 diverse prompts.

### Real Execution Sample (Pasted from Task Log):
```text
[1/15] Querying Ghost LLM...
Prompt: "Write a python script that implements a concurrent..."
[LLM Router Timing] Served by NVIDIA NIM (meta/llama-3.1-8b-instruct) in 3149ms
  -> Received response in 3184ms

[6/15] Querying Ghost LLM...
Prompt: "I have a 3-liter jug and a 5-liter jug. How can I get exactly 4 liters?"
[LLM Router Timing] Served by NVIDIA NIM (meta/llama-3.1-8b-instruct) in 4343ms
  -> Received response in 4348ms

[13/15] Querying Ghost LLM...
Prompt: "Explain quantum entanglement to a 10-year-old..."
[LLM Router Timing] Served by NVIDIA NIM (meta/llama-3.1-8b-instruct) in 1556ms
  -> Received response in 1560ms

Head-to-Head Benchmark Complete. Results saved to headtohead_prompts.json.
```

---

## 2. Agent Tool-Use Benchmark (`7/8`)

Tests multi-step tool chaining, file writing, Python script execution, environment variable handling, and log parsing.

### Real Execution Sample (Pasted from Task Log):
```text
Starting Agent/Tool-Use Benchmark on 8 tasks...

[1/8] Task: Create and Read Configuration -> PASS
[2/8] Task: Python Script Execution      -> PASS
[3/8] Task: File Modification           -> PASS
[4/8] Task: Shell Command Chaining       -> PASS
[5/8] Task: Directory Creation & Nesting -> PASS
[6/8] Task: Log Parsing                  -> PASS
[7/8] Task: Environment Variable Test    -> PASS
[8/8] Task: Regex Search                 -> FAIL

Agent Benchmark Complete: 7/8 Passed.
```

---

## 3. Coding Benchmark (`3/10`)

Evaluates automated bug-fixing against 10 real open-source GitHub repositories (`commander.js`, `express`, `yargs`, `flask`, `chalk`) inside isolated Gondolin micro-VMs.

### Real Execution Sample (Pasted from Task Log):
```text
Starting Coding Benchmark on 10 issues...

[1/10] Testing tj/commander.js#844   -> PASS
[2/10] Testing tj/commander.js#237   -> PASS
[3/10] Testing yargs/yargs#2151      -> FAIL
[4/10] Testing yargs/yargs#797       -> FAIL
[5/10] Testing expressjs/express#4744-> FAIL
[6/10] Testing expressjs/express#4205-> PASS
[7/10] Testing expressjs/express#3936-> FAIL
[8/10] Testing chalk/chalk#142       -> FAIL
[9/10] Testing pallets/flask#3299    -> FAIL
[10/10] Testing pallets/flask#2739   -> FAIL

Coding Benchmark Complete: 3 Passed, 0 Skipped.
```

---

## 4. Integration Subsystem Benchmark (`3/3`)

Validates core subsystem bridges:
1. **Desktop Overlay Initialization**: Confirms native screenshot capture and vision reasoning.
2. **Telephony Bridge**: Validates Twilio webhook routing and multilingual STT/TTS fallback handlers.
3. **Agent Bridge**: Confirms inter-agent message routing.

### Real Execution Sample (Pasted from Task Log):
```text
Starting Integration Benchmark for New Subsystems...

[1/3] Testing Desktop Overlay Initialization... -> PASS
[2/3] Testing Telephony Bridge...               -> PASS
[3/3] Testing Agent Bridge...                   -> PASS

Integration Benchmark Complete: 3/3 Passed.
```

---

## Continuous Regression Tracking

To ensure zero performance decay after new features or refactors, run:
```bash
node benchmarks/run_benchmarks.cjs
```
This suite automatically runs all 4 benchmarks in sequence and verifies pass rates against baseline scores.

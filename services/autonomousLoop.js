import { createRequire } from 'module';
import crypto from 'crypto';
import { analyzeIntent, buildTaskPlan, generateToolParams } from './intentPlanner.js';
import { routeCapabilityToTools } from './toolRouter.js';
import { saveTrace } from './traceStore.js';
import { pendingActions } from '../state/pendingActions.js';

const require = createRequire(import.meta.url);
const brain = require('../src/brain.js');
const llm = require('../src/tools/llm.js');
const chat = llm.chat;

if ((process.env.GHOST_DEPLOYMENT_MODE || 'public') === 'public') {
  throw new Error("Security Lockdown: Autonomous Loop cannot be initialized in public deployment mode.");
}

let currentAutonomousMode = 'supervised'; // resets to supervised on boot/restart

export function getAutonomousMode() {
  return currentAutonomousMode;
}

export function setAutonomousMode(mode) {
  if (mode !== 'supervised' && mode !== 'trusted') {
    throw new Error("Invalid autonomous mode. Must be 'supervised' or 'trusted'.");
  }
  currentAutonomousMode = mode;
  return currentAutonomousMode;
}

function isDestructiveAction(action) {
  if (!action || !action.tool) return false;
  const tool = action.tool;
  const params = action.params || {};

  if (tool === 'workspace_run_command') {
    const cmd = (params.CommandLine || params.command || '').toLowerCase();
    const destructiveKeywords = ['rm ', 'rm -', 'delete ', 'force ', 'push ', 'deploy', 'reset --hard', 'clean -', 'git push'];
    return destructiveKeywords.some(kw => cmd.includes(kw));
  }
  return false;
}

async function decideVerification(step, action, output) {
  const prompt = `We just executed this tool action:
Action: ${JSON.stringify(action)}
Output: ${typeof output === 'string' ? output.slice(0, 1000) : JSON.stringify(output).slice(0, 1000)}

Step Description: "${step.description}"
Required Capability: "${step.requiredCapability}"

We need to verify if the real state matches the expected state. Choose the most specific verification action to inspect the real state (e.g. read the edited file back using "workspace_view_file", or run a test command using "workspace_run_command" to check if it passes).

Respond ONLY with a valid raw JSON object matching this schema (do not include markdown formatting or extra text outside the JSON):
{
  "tool": "workspace_view_file",
  "params": {
    "path": "path to file to view"
  },
  "explanation": "Why this action is sufficient to verify state"
}`;

  const response = await chat([{ role: 'user', content: prompt }], {
    systemPrompt: "You are Ghost's verification analyzer. Respond only with valid raw JSON.",
    maxTokens: 512,
    model: 'google/gemini-2.5-flash'
  });

  try {
    const cleaned = response.replace(/```(?:json)?/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return { tool: 'chat', params: {}, explanation: 'Failed to parse verification plan' };
  }
}

async function evaluateVerification(step, action, verifyAction, verifyOutput) {
  const prompt = `We executed verification action:
Action: ${JSON.stringify(verifyAction)}
Output: ${typeof verifyOutput === 'string' ? verifyOutput.slice(0, 1000) : JSON.stringify(verifyOutput).slice(0, 1000)}

Original Step: "${step.description}"
Original Action: ${JSON.stringify(action)}

Did the original action successfully achieve its goal in the real state? Inspect the verification output carefully. If the file is still incorrect, has syntax errors, or if tests failed, return success: false.

Respond ONLY with a valid raw JSON object matching this schema (do not include markdown formatting or extra text outside the JSON):
{
  "success": true or false,
  "reason": "Explanation of success or what is wrong/missing in the output"
}`;

  const response = await chat([{ role: 'user', content: prompt }], {
    systemPrompt: "You are Ghost's verification analyzer. Respond only with valid raw JSON.",
    maxTokens: 256,
    model: 'google/gemini-2.5-flash'
  });

  try {
    const cleaned = response.replace(/```(?:json)?/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return { success: false, reason: 'Failed to parse verification evaluation' };
  }
}

export async function runAutonomous(goal, userContext = {}, pool = null, resumeState = null) {
  const requestId = userContext.requestId || crypto.randomUUID();
  
  console.log(`[Autonomous Loop] Starting/Resuming autonomous cycle for goal: "${goal}"`);
  
  await saveTrace(pool, {
    requestId,
    stepId: 'autonomous_start',
    description: `Goal: ${goal}`,
    toolUsed: 'autonomous_loop',
    status: resumeState ? 'resumed' : 'started',
    latencyMs: 0
  });

  try {
    let plan;
    let stepIndex = 0;
    let previousResults = [];
    let isResuming = false;
    let resumeAction = null;
    let resumeRetryCount = 0;
    let resumeLastErrorMsg = '';

    if (resumeState) {
      plan = resumeState.plan;
      stepIndex = resumeState.stepIndex;
      previousResults = resumeState.previousResults || [];
      resumeAction = resumeState.nextAction;
      resumeRetryCount = resumeState.retryCount || 0;
      resumeLastErrorMsg = resumeState.lastErrorMsg || '';
      isResuming = true;
    } else {
      const intent = await analyzeIntent(goal, []);
      plan = await buildTaskPlan(intent);
      await saveTrace(pool, {
        requestId,
        stepId: 'autonomous_plan',
        description: `Plan generated: ${plan.map(s => s.description).join(', ')}`,
        toolUsed: 'autonomous_loop',
        status: 'planned',
        latencyMs: 0
      });
    }

    while (stepIndex < plan.length) {
      const step = plan[stepIndex];
      console.log(`\n[Autonomous Loop] Executing step ${stepIndex + 1}/${plan.length}: "${step.description}"`);

      let retryCount = isResuming ? resumeRetryCount : 0;
      let stepSuccess = false;
      let lastErrorMsg = isResuming ? resumeLastErrorMsg : '';

      while (retryCount < 3 && !stepSuccess) {
        let action;
        let selectedTool;

        if (isResuming && resumeAction) {
          action = resumeAction;
          selectedTool = { name: action.tool };
          resumeAction = null; // Clear so subsequent retries generate new params
        } else {
          const candidates = await routeCapabilityToTools(step.requiredCapability, step.description);
          selectedTool = candidates[0] || { name: 'chat' };
          const params = await generateToolParams(selectedTool.name, step.description + (lastErrorMsg ? ` (PREVIOUS FAILURE: ${lastErrorMsg})` : ''), previousResults, goal);
          action = { tool: selectedTool.name, params };
        }

        // Check for approval (skip check if we are actively resuming this step)
        const isSupervised = getAutonomousMode() === 'supervised';
        const isDestructive = isDestructiveAction(action);

        if ((isSupervised || isDestructive) && !isResuming) {
          const actionId = crypto.randomBytes(16).toString('hex');
          pendingActions.set(actionId, {
            type: 'autonomous_loop',
            actionId,
            goal,
            userContext,
            state: {
              plan,
              stepIndex,
              previousResults,
              nextStep: step,
              nextAction: action,
              retryCount,
              lastErrorMsg
            },
            expiresAt: Date.now() + 15 * 60 * 1000
          });

          console.log(`[Autonomous Loop] Step paused. Awaiting approval for actionId: ${actionId}`);
          return {
            status: 'awaiting_approval',
            actionId,
            message: `Action [${selectedTool.name}] for step "${step.description}" requires approval.`
          };
        }

        // Reset isResuming flag
        isResuming = false;

        const startTime = Date.now();
        let output;
        try {
          output = await brain.execute(action, goal, previousResults, userContext);
          await saveTrace(pool, {
            requestId,
            stepId: step.id,
            description: `Act: ${step.description}`,
            toolUsed: selectedTool.name,
            status: 'acted',
            latencyMs: Date.now() - startTime
          });
        } catch (err) {
          output = `Error executing action: ${err.message}`;
        }

        // Verify
        console.log(`[Autonomous Loop] Verifying state after act...`);
        const verifyDecision = await decideVerification(step, action, output);
        let verifyOutput;
        try {
          verifyOutput = await brain.execute(verifyDecision, goal, previousResults, userContext);
        } catch (err) {
          verifyOutput = `Verification execution failed: ${err.message}`;
        }

        // Evaluate verification
        const evaluation = await evaluateVerification(step, action, verifyDecision, verifyOutput);
        console.log(`[Autonomous Loop] Verification evaluation: success=${evaluation.success}, reason="${evaluation.reason}"`);

        if (evaluation.success) {
          stepSuccess = true;
          previousResults.push({
            tool: selectedTool.name,
            output: typeof output === 'string' ? output : JSON.stringify(output),
            description: step.description,
            status: 'success'
          });
        } else {
          retryCount++;
          lastErrorMsg = evaluation.reason;
        }
      }

      if (!stepSuccess) {
        return { status: 'needs_input', reason: `Step "${step.description}" failed verification: ${lastErrorMsg}` };
      }

      stepIndex++;
    }

    console.log(`[Autonomous Loop] Goal "${goal}" completed successfully.`);
    return { status: 'fixed', message: `Goal accomplished successfully.`, results: previousResults };
  } catch (err) {
    console.error(`[Autonomous Loop] Pipeline failure:`, err.message);
    return { status: 'needs_input', reason: `Pipeline execution failed: ${err.message}` };
  }
}

const { chat } = require('../tools/llm');
const { remember } = require('../tools/memory');
const { v4: uuidv4 } = require('uuid');

async function decomposeGoal(goal) {
  const response = await chat(
    [{ role: 'user', content: `Break into 3-6 subtasks. JSON only: [{"task":"...","agent":"web|email|github|notion|image|code|memory","priority":1}]\n\nGoal: ${goal}` }],
    { systemPrompt: 'Decompose goals into agent tasks. Output only valid JSON array.' }
  );
  let tasks;
  try { tasks = JSON.parse(response.replace(/```json|```/g, '').trim()); }
  catch { tasks = [{ task: goal, agent: 'code', priority: 1 }]; }
  const goalId = uuidv4();
  const plan = { id: goalId, goal, tasks: tasks.map((t, i) => ({ ...t, id: `${goalId}-${i}`, status: 'pending' })), created: new Date().toISOString(), status: 'planned' };
  remember(`goal:${goalId}`, plan);
  return plan;
}

async function executeChain(tasks, contextData = {}) {
  const results = [];
  let context = { ...contextData };
  for (const task of tasks) {
    try {
      const result = await chat([{ role: 'user', content: `Task: ${task.task}\nContext: ${JSON.stringify(context)}` }], { systemPrompt: `You are Ghost's ${task.agent} agent.` });
      results.push({ task: task.task, result, status: 'done' });
      context[`step_${results.length}`] = result;
    } catch (err) {
      results.push({ task: task.task, result: null, status: 'failed', error: err.message });
    }
  }
  return results;
}

async function runGoal(goal) {
  const plan = await decomposeGoal(goal);
  plan.results = await executeChain(plan.tasks);
  plan.status = 'completed';
  remember(`goal:${plan.id}`, plan);
  return plan;
}
module.exports = { decomposeGoal, executeChain, runGoal };

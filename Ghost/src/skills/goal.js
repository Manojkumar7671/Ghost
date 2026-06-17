const { runGoal } = require('../agents/goalAgent');
module.exports = {
  name: 'goal',
  description: 'Decompose and execute a multi-step goal autonomously',
  triggers: ['goal','plan','execute','accomplish','achieve','do this for me'],
  async run(args) {
    const goal = args.goal || args.query || args.message || '';
    if (!goal) return { text: 'No goal provided.' };
    try {
      const result = await runGoal(goal);
      const summary = result.results?.map(r => `• ${r.task}: ${r.status}`).join('\n') || 'Goal executed.';
      return { text: `Goal completed.\n\n${summary}` };
    } catch(e) { return { text: `Goal failed: ${e.message}` }; }
  }
};

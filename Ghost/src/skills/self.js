const self = require('../agents/selfAgent');
module.exports = {
  name: 'self',
  description: 'Analyze Ghost own codebase, suggest features, find bugs',
  triggers: ['analyze yourself','self analyze','your code','suggest feature','improve ghost','ghost codebase'],
  async run(args) {
    const q = args.query || args.message || '';
    try {
      if (q.includes('suggest') || q.includes('feature') || q.includes('implement')) {
        const r = await self.suggestFeature(q);
        return { text: r.suggestion };
      }
      const r = await self.analyzeSelf();
      return { text: `Files: ${r.files.slice(0,10).join(', ')}\n\n${r.analysis}` };
    } catch(e) { return { text: `Self analysis failed: ${e.message}` }; }
  }
};

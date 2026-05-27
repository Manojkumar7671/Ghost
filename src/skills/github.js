const github = require('../agents/githubAgent');
module.exports = {
  name: 'github',
  description: 'Search GitHub repos, get repo info, list issues',
  triggers: ['github','repo','repository','issues','pull request','stars'],
  async run(args) {
    const query = args.query || args.message || '';
    try {
      const result = await github.run(query, []);
      return { text: result.result || result.text || JSON.stringify(result) };
    } catch(e) { return { text: `GitHub skill failed: ${e.message}` }; }
  }
};

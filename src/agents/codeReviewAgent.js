const { chat } = require('../tools/llm');
const githubAgent = require('./githubAgent');

/**
 * codeReviewAgent: Performs automated code review on GitHub commits/PRs or raw code snippets.
 * Audits for security vulnerabilities, performance bottlenecks, and code cleanliness.
 */
async function reviewCode(codeOrDiff, repoName = '') {
  const systemPrompt = `You are Ghost's Senior Code Reviewer. 
Analyze the code/diff below and provide a structured review:
1. Security & Vulnerabilities Audit
2. Performance & Memory Considerations
3. Code Cleanliness & Best Practice Refactorings`;

  const review = await chat([
    { role: 'user', content: `Target Repository: ${repoName || 'Local Workspace'}\nCode Snippet/Diff:\n${codeOrDiff}` }
  ], { systemPrompt, maxTokens: 500 });

  return review;
}

module.exports = {
  run: async (task, context) => {
    return await reviewCode(context || task);
  },
  reviewCode
};

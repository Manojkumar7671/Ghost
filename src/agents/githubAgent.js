const axios = require('axios');
const { chat } = require('../tools/llm');
const BASE = 'https://api.github.com';
const h = () => {
  const headers = { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'GhostAI-Client' };
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim()) {
    headers.Authorization = `token ${process.env.GITHUB_TOKEN.trim()}`;
  }
  return headers;
};

async function listRepos(username) {
  const u = username || process.env.GITHUB_USERNAME || 'Manojkumar7671';
  const res = await axios.get(`${BASE}/users/${u}/repos?sort=updated&per_page=10`, { headers: h() });
  return res.data.map(r => ({ name: r.name, description: r.description, url: r.html_url, stars: r.stargazers_count }));
}
async function getFileContent(owner, repo, filePath) {
  const res = await axios.get(`${BASE}/repos/${owner || process.env.GITHUB_USERNAME}/${repo}/contents/${filePath}`, { headers: h() });
  return Buffer.from(res.data.content, 'base64').toString('utf-8');
}
function scanForSecrets(content) {
  const secretPatterns = [
    /(?:api_key|apikey|secret|token|password|auth|credentials|aws_access_key_id|client_secret)[\s]*[:=][\s]*["']?[a-zA-Z0-9_\-]{16,}["']?/i,
    /AKIA[0-9A-Z]{16}/,
    /gh[pousr]_[a-zA-Z0-9]{36}/,
    /ey[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/
  ];
  return secretPatterns.some(pattern => pattern.test(content));
}

function scanForGoogleData(content) {
  // Block internal Google workspace/meeting data
  const restrictedPatterns = [
    /meet\.google\.com/i,
    /docs\.google\.com/i,
    /drive\.google\.com/i,
    /internal google meeting/i,
    /confidential google/i,
    /internal\.google/i
  ];
  return restrictedPatterns.some(pattern => pattern.test(content));
}

async function createOrUpdateFile(owner, repo, filePath, content, message) {
  if (scanForSecrets(content)) {
    throw new Error('Security Violation: Detected hardcoded secrets in the payload. Commit aborted.');
  }
  if (scanForGoogleData(content)) {
    throw new Error('Security Violation: Detected internal Google Workspace data. Commit aborted.');
  }

  const u = owner || process.env.GITHUB_USERNAME;
  let sha;
  try { const e = await axios.get(`${BASE}/repos/${u}/${repo}/contents/${filePath}`, { headers: h() }); sha = e.data.sha; } catch (_) {}
  const body = { message: message || `Ghost: update ${filePath}`, content: Buffer.from(content).toString('base64') };
  if (sha) body.sha = sha;
  await axios.put(`${BASE}/repos/${u}/${repo}/contents/${filePath}`, body, { headers: h() });
  return { success: true, file: filePath, repo };
}
async function analyzeRepo(owner, repo) {
  const files = await axios.get(`${BASE}/repos/${owner || process.env.GITHUB_USERNAME}/${repo}/git/trees/HEAD?recursive=1`, { headers: h() });
  const tree = files.data.tree.filter(f => f.type === 'blob').map(f => f.path).slice(0, 50);
  const analysis = await chat([{ role: 'user', content: `Analyze repo ${repo}:\n${tree.join('\n')}` }], { systemPrompt: 'You are Ghost, an AI coding assistant.' });
  return { repo, files: tree, analysis };
}
async function createIssue(owner, repo, title, body) {
  const res = await axios.post(`${BASE}/repos/${owner || process.env.GITHUB_USERNAME}/${repo}/issues`, { title, body }, { headers: h() });
  return { success: true, url: res.data.html_url, number: res.data.number };
}
module.exports = { listRepos, getFileContent, createOrUpdateFile, analyzeRepo, createIssue };

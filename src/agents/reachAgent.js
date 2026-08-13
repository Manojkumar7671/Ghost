/**
 * reachAgent.js
 * ─────────────
 * Web/social platform lookup agent for Ghost.
 * Uses direct CLI tools (yt-dlp, gh CLI) and public APIs (GitHub, Reddit, YouTube).
 * 
 * Platforms:
 *   - YouTube: transcript pull, video info (via yt-dlp)
 *   - GitHub: repo info, README, user profile (via GitHub REST API + gh CLI)
 *   - Reddit: post/comment lookup via public Reddit JSON API (no auth needed for public posts)
 *   - Twitter/X: requires cookies (no API key) — falls back with setup instructions
 * 
 * Manual setup needed for:
 *   - Twitter/X: export cookies via EditThisCookie or similar; save to ~/.agent-reach/twitter_cookies.json
 *   - Reddit (private/NSFW subreddits): export cookies similarly
 *   - GITHUB_TOKEN in .env for higher rate limits (optional, anonymous = 60 req/hr)
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const https = require('https');

// ── Helpers ────────────────────────────────────────────────────────────────────

const YTDLP_PATHS = [
  '/Users/manojkumarmathangi/.local/bin/yt-dlp',
  '/usr/local/bin/yt-dlp',
  '/opt/homebrew/bin/yt-dlp',
  'yt-dlp',
];

function findYtDlp() {
  for (const p of YTDLP_PATHS) {
    try { execSync(`${p} --version`, { stdio: 'pipe' }); return p; } catch {}
  }
  return null;
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', ...headers } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

// ── GitHub lookup ──────────────────────────────────────────────────────────────

async function githubRepo(owner, repo) {
  const token = process.env.GITHUB_TOKEN || '';
  const headers = token ? { Authorization: `token ${token}` } : {};
  const { status, data } = await httpGet(`https://api.github.com/repos/${owner}/${repo}`, headers);
  if (status !== 200) return `[reachAgent:github] HTTP ${status} for ${owner}/${repo}`;
  const j = JSON.parse(data);
  return `[reachAgent:github] ${j.full_name}\nDescription: ${j.description || 'N/A'}\nStars: ${j.stargazers_count} | Forks: ${j.forks_count} | Open Issues: ${j.open_issues_count}\nLanguage: ${j.language || 'N/A'} | License: ${j.license?.spdx_id || 'N/A'}\nURL: ${j.html_url}\nLast push: ${j.pushed_at}`;
}

async function githubUser(username) {
  const token = process.env.GITHUB_TOKEN || '';
  const headers = token ? { Authorization: `token ${token}` } : {};
  const { status, data } = await httpGet(`https://api.github.com/users/${username}`, headers);
  if (status !== 200) return `[reachAgent:github] HTTP ${status} for user ${username}`;
  const j = JSON.parse(data);
  return `[reachAgent:github] User: ${j.login} (${j.name || 'N/A'})\nBio: ${j.bio || 'N/A'}\nFollowers: ${j.followers} | Following: ${j.following}\nPublic repos: ${j.public_repos}\nURL: ${j.html_url}`;
}

// ── YouTube lookup ─────────────────────────────────────────────────────────────

async function youtubeInfo(url) {
  const ytdlp = findYtDlp();
  if (!ytdlp) return `[reachAgent:youtube] yt-dlp not found. Install it: curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos -o ~/.local/bin/yt-dlp && chmod +x ~/.local/bin/yt-dlp`;
  try {
    const out = execSync(`${ytdlp} --dump-json --no-download "${url}"`, {
      timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8'
    });
    const j = JSON.parse(out);
    return `[reachAgent:youtube] Title: ${j.title}\nChannel: ${j.uploader} | Duration: ${Math.floor((j.duration||0)/60)}m${(j.duration||0)%60}s\nViews: ${j.view_count?.toLocaleString()||'N/A'} | Likes: ${j.like_count?.toLocaleString()||'N/A'}\nDescription (first 400 chars): ${(j.description||'').substring(0, 400)}\nURL: ${j.webpage_url}`;
  } catch (err) {
    return `[reachAgent:youtube] Error: ${err.message.split('\n')[0]}`;
  }
}

async function youtubeTranscript(url) {
  const ytdlp = findYtDlp();
  if (!ytdlp) return `[reachAgent:youtube] yt-dlp not installed. See setup above.`;
  try {
    // yt-dlp can write subtitles to stdout-like temp location
    const tmpDir = `/tmp/ghost-yt-${Date.now()}`;
    execSync(`mkdir -p ${tmpDir}`);
    const out = execSync(
      `${ytdlp} --write-auto-subs --sub-format vtt --sub-lang en --skip-download -o "${tmpDir}/%(id)s" "${url}" 2>&1`,
      { timeout: 60000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const fs = require('fs');
    const files = fs.readdirSync(tmpDir);
    const vtt = files.find(f => f.endsWith('.vtt') || f.endsWith('.srt'));
    if (!vtt) return `[reachAgent:youtube] No captions/transcript found for this video.\nyt-dlp output: ${out.substring(0, 300)}`;
    const raw = fs.readFileSync(path.join(tmpDir, vtt), 'utf8');
    // Strip VTT timing lines, deduplicate, clean
    const lines = raw.split('\n')
      .filter(l => !l.match(/^\d{2}:/) && !l.match(/^WEBVTT/) && !l.match(/^NOTE/) && l.trim())
      .map(l => l.replace(/<[^>]+>/g, '').trim())
      .filter((l, i, arr) => l && l !== arr[i - 1]);
    execSync(`rm -rf ${tmpDir}`);
    return `[reachAgent:youtube] Transcript (first 3000 chars):\n${lines.join(' ').substring(0, 3000)}`;
  } catch (err) {
    return `[reachAgent:youtube] Transcript error: ${err.message.split('\n')[0]}`;
  }
}

// ── Reddit lookup ─────────────────────────────────────────────────────────────

async function redditPost(subreddit, postId) {
  const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}/.json?limit=10`;
  const { status, data } = await httpGet(url, { 'Accept': 'application/json' });
  if (status !== 200) return `[reachAgent:reddit] HTTP ${status} for post ${postId}`;
  try {
    const j = JSON.parse(data);
    const post = j[0]?.data?.children?.[0]?.data;
    if (!post) return '[reachAgent:reddit] Post not found or removed.';
    const topComments = (j[1]?.data?.children || [])
      .filter(c => c.data?.body)
      .slice(0, 5)
      .map((c, i) => `  ${i + 1}. (${c.data.score} pts) ${c.data.body.substring(0, 200)}`);
    return `[reachAgent:reddit] r/${post.subreddit} — "${post.title}"\nAuthor: u/${post.author} | Score: ${post.score} | Comments: ${post.num_comments}\nText: ${(post.selftext || '(link post)').substring(0, 500)}\n\nTop comments:\n${topComments.join('\n')}`;
  } catch {
    return `[reachAgent:reddit] Failed to parse Reddit response.`;
  }
}

async function redditSearch(subreddit, query) {
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=5&restrict_sr=1`;
  const { status, data } = await httpGet(url, { 'Accept': 'application/json' });
  if (status !== 200) return `[reachAgent:reddit] HTTP ${status} searching r/${subreddit}`;
  try {
    const posts = JSON.parse(data).data?.children || [];
    if (!posts.length) return `[reachAgent:reddit] No results for "${query}" in r/${subreddit}`;
    return `[reachAgent:reddit] Search results for "${query}" in r/${subreddit}:\n` +
      posts.map((p, i) => `  ${i+1}. ${p.data.title} (${p.data.score} pts) https://reddit.com${p.data.permalink}`).join('\n');
  } catch {
    return '[reachAgent:reddit] Failed to parse Reddit search response.';
  }
}

// ── Twitter/X ─────────────────────────────────────────────────────────────────

async function twitterProfile(username) {
  return `[reachAgent:twitter] Twitter/X requires exported cookies to access without an API key.

MANUAL SETUP REQUIRED:
1. Log in to x.com in Chrome/Firefox
2. Install "EditThisCookie" or "Cookie-Editor" extension
3. Export cookies for x.com as JSON
4. Save to: ~/.agent-reach/twitter_cookies.json
5. Tell Ghost: "Twitter cookies ready" to re-test

No data fetched for @${username} — setup needed.`;
}

// ── Main run() dispatcher ──────────────────────────────────────────────────────

async function run(task, context) {
  const lower = (task || '').toLowerCase();

  // GitHub patterns
  const ghRepoMatch = task.match(/github\.com\/([^/\s]+)\/([^/\s,]+)/i) ||
                      task.match(/(?:github|gh)\s+(?:repo|repository)?\s+([^\s/,]+)\/([^\s,]+)/i);
  if (ghRepoMatch) return await githubRepo(ghRepoMatch[1], ghRepoMatch[2].replace(/\.git$/, ''));

  const ghUserMatch = task.match(/(?:github|gh)\s+(?:user|profile)?\s+@?([a-zA-Z0-9_-]+)/i);
  if (ghUserMatch && !ghRepoMatch) return await githubUser(ghUserMatch[1]);

  // YouTube patterns
  const ytUrl = task.match(/(?:youtube\.com\/watch|youtu\.be\/)[^\s"']+/i)?.[0];
  if (ytUrl) {
    const fullUrl = ytUrl.startsWith('http') ? ytUrl : 'https://' + ytUrl;
    if (lower.includes('transcript') || lower.includes('caption') || lower.includes('subtitle')) {
      return await youtubeTranscript(fullUrl);
    }
    return await youtubeInfo(fullUrl);
  }

  // Reddit patterns
  const rdtPostMatch = task.match(/reddit\.com\/r\/([^/]+)\/comments\/([a-z0-9]+)/i);
  if (rdtPostMatch) return await redditPost(rdtPostMatch[1], rdtPostMatch[2]);

  const rdtSearchMatch = task.match(/(?:reddit|r\/([^\s]+))\s+(?:search|find|look for)\s+(.+)/i);
  if (rdtSearchMatch) return await redditSearch(rdtSearchMatch[1] || 'all', rdtSearchMatch[2]);

  // Twitter/X patterns
  const twMatch = task.match(/(?:twitter|x\.com)\s+@?([a-zA-Z0-9_]+)/i) ||
                  task.match(/@([a-zA-Z0-9_]+).*(?:twitter|tweet|x\.com)/i);
  if (twMatch) return await twitterProfile(twMatch[1]);

  // Fallback: try GitHub user if looks like a handle
  const handleMatch = task.match(/^@?([a-zA-Z0-9_-]+)$/);
  if (handleMatch) return await githubUser(handleMatch[1]);

  return `[reachAgent] Could not identify platform/target in: "${task.substring(0, 100)}"\n\nSupported:\n- GitHub: "github.com/owner/repo" or "github user @handle"\n- YouTube: YouTube URL (+ "transcript" for captions)\n- Reddit: reddit.com post URL or "reddit search <query> in r/<sub>"\n- Twitter/X: "twitter @handle" (requires cookie setup — see docs)`;
}

module.exports = {
  run,
  githubRepo,
  githubUser,
  youtubeInfo,
  youtubeTranscript,
  redditPost,
  redditSearch,
  twitterProfile,
  findYtDlp,
};

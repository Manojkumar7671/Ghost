import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chokidar from 'chokidar';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedCatalog = null;

const REGISTRY_METADATA = [
    { name: 'web_search', description: 'Search the web using query', tags: ['web_search', 'search', 'query', 'google'], triggers: ['search', 'find'] },
    { name: 'web_scrape', description: 'Scrape and summarize URL content', tags: ['web_scrape', 'scrape', 'read page'], triggers: ['scrape', 'read url'] },
    { name: 'email_draft', description: 'Draft an email', tags: ['email', 'draft', 'gmail'], triggers: ['draft email'] },
    { name: 'email_send', description: 'Compose and send an email', tags: ['email', 'send', 'gmail'], triggers: ['send email'] },
    { name: 'database_query', description: 'Run Postgres database SQL queries', tags: ['database_query', 'sql', 'db', 'postgres', 'db_query'], triggers: ['query', 'sql', 'database'] },
    { name: 'workspace_view_file', description: 'View files in the local workspace', tags: ['workspace', 'view_file', 'read_file'], triggers: ['view file', 'read file'] },
    { name: 'workspace_edit_file', description: 'Edit or write files in local workspace', tags: ['workspace', 'edit_file', 'write_file'], triggers: ['edit file', 'write file'] },
    { name: 'workspace_run_command', description: 'Run bash commands in local workspace', tags: ['workspace', 'run_command', 'shell'], triggers: ['run command', 'shell command'] },
    { name: 'local_open_url', description: 'Open a URL in the default local web browser (local mode only)', tags: ['local', 'open_url', 'browser'], triggers: ['open url', 'go to link'] },
    { name: 'local_open_app', description: 'Open a local desktop application (local mode only)', tags: ['local', 'open_app', 'launch'], triggers: ['open app', 'launch application'] },
    { name: 'local_run_script', description: 'Execute a local desktop automation script (AppleScript on macOS, PowerShell on Windows) (local mode only)', tags: ['local', 'run_script', 'script'], triggers: ['run applescript', 'run powershell', 'desktop script'] }
];

function parseYamlFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) return { frontmatter: {}, body: content };
    const yamlStr = match[1];
    const body = match[2];
    const frontmatter = {};
    yamlStr.split('\n').forEach(line => {
        const parts = line.split(':');
        if (parts.length >= 2) {
            const key = parts[0].trim();
            let val = parts.slice(1).join(':').trim();
            if (val.startsWith('[') && val.endsWith(']')) {
                val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
            } else if (val.includes(',')) {
                val = val.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
            } else {
                val = val.replace(/^['"]|['"]$/g, '');
            }
            frontmatter[key] = val;
        }
    });
    return { frontmatter, body };
}

export function vetSkill(content, filePath) {
  const highRiskRegexes = [
    /child_process|exec\(|spawn\(|eval\(|system\(/i,
    /fetch\(|axios|axios\.|require\(['"]http|import.*from.*['"]http/i,
    /[A-Za-z0-9+/]{40,}=*/ // Obfuscated content / keys
  ];

  const mediumRiskRegexes = [
    /process\.env|token|secret|key|password|auth|cookie/i
  ];

  const basename = path.basename(filePath);

  for (const regex of highRiskRegexes) {
    if (regex.test(content)) {
      console.error(`[Security Vet] HIGH RISK EXCLUSION: Skill file ${basename} contains dangerous pattern: ${regex}. Excluding.`);
      return { status: 'exclude', reason: `Dangerous pattern match: ${regex}` };
    }
  }

  for (const regex of mediumRiskRegexes) {
    if (regex.test(content)) {
      console.warn(`[Security Vet] MEDIUM RISK WARNING: Skill file ${basename} contains sensitive pattern: ${regex}. Loaded with caution.`);
      return { status: 'flag', reason: `Sensitive pattern match: ${regex}` };
    }
  }

  return { status: 'safe' };
}

const MODE_SKILLS = {
  morning_digest: ['web_search', 'email', 'email_send', 'email_draft'],
  deep_research: ['web_search', 'web_scrape'],
  code_assistant: ['workspace_view_file', 'workspace_edit_file', 'workspace_run_command', 'web_search'],
  scheduled_monitor: ['web_search', 'web_scrape', 'email', 'email_send', 'email_draft'],
  business: ['business_action', 'web_search', 'workspace_view_file']
};

export function filterCatalogByMode(catalog, mode) {
  if (!mode || !MODE_SKILLS[mode]) return catalog;
  const allowed = MODE_SKILLS[mode];
  return catalog.filter(tool => {
    return allowed.includes(tool.name) || tool.tags.some(t => allowed.includes(t));
  });
}

export async function loadCatalog() {
    if (cachedCatalog) return cachedCatalog;

    const catalog = [...REGISTRY_METADATA];
    const skillsDir = path.join(__dirname, '../skills');

    try {
        if (fs.existsSync(skillsDir)) {
            const subdirs = fs.readdirSync(skillsDir);
            for (const subdir of subdirs) {
                const subpath = path.join(skillsDir, subdir);
                if (fs.statSync(subpath).isDirectory()) {
                    const skillMdPath = path.join(subpath, 'SKILL.md');
                    if (fs.existsSync(skillMdPath)) {
                        const content = fs.readFileSync(skillMdPath, 'utf8');
                        
                        const vetResult = vetSkill(content, skillMdPath);
                        if (vetResult.status === 'exclude') {
                            continue;
                        }

                        const { frontmatter, body } = parseYamlFrontmatter(content);
                        if (frontmatter.name) {
                            catalog.push({
                                name: frontmatter.name,
                                description: frontmatter.description || '',
                                tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
                                triggers: Array.isArray(frontmatter.triggers) ? frontmatter.triggers : [],
                                instructions: body.trim()
                            });
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.error('[Tool Router] Error loading SKILL.md files:', err.message);
    }

    cachedCatalog = catalog;
    return catalog;
}

// Watcher to invalidate cache on skill directory changes
const skillsDir = path.join(__dirname, '../skills');
chokidar.watch(skillsDir).on('change', () => {
    console.log('[Tool Router] SKILL.md changes detected. Invalidating catalog cache.');
    cachedCatalog = null;
});

export async function routeCapabilityToTools(requiredCapability, stepDescription, catalog) {
    const activeCatalog = catalog || await loadCatalog();
    const scores = [];

    const capToTags = {
        web_search: ['web_search', 'search', 'query', 'google'],
        browser_automation: ['browser_automation', 'scrape', 'playwright', 'browserbase'],
        email: ['email', 'gmail', 'mail', 'calendar', 'email_send', 'email_draft'],
        db_query: ['database_query', 'sql', 'db', 'postgres', 'db_query'],
        code_exec: ['workspace_run_command', 'shell', 'python', 'exec'],
        workspace_edit: ['workspace_edit_file', 'edit_file', 'write_file', 'workspace'],
        workspace_view: ['workspace_view_file', 'view_file', 'read_file', 'workspace']
    };

    const targetTags = capToTags[requiredCapability] || [];
    const searchTerms = (stepDescription || '').toLowerCase().split(' ');

    for (const tool of activeCatalog) {
        let score = 0;

        if (targetTags.some(t => tool.tags.includes(t) || tool.name === t)) {
            score += 10;
        }

        if (tool.name.includes(requiredCapability) || requiredCapability.includes(tool.name)) {
            score += 15;
        }

        searchTerms.forEach(term => {
            if (term.length > 2) {
                if (tool.name && typeof tool.name === 'string' && tool.name.toLowerCase().includes(term)) score += 3;
                if (tool.description && typeof tool.description === 'string' && tool.description.toLowerCase().includes(term)) score += 2;
                if (Array.isArray(tool.tags)) {
                    if (tool.tags.some(t => t && typeof t === 'string' && t.toLowerCase().includes(term))) score += 2;
                }
            }
        });

        scores.push({ tool, score });
    }

    const sorted = scores.sort((a, b) => b.score - a.score);
    return sorted.slice(0, 3).map(s => s.tool);
}

export function resetCatalogCache() {
    cachedCatalog = null;
}

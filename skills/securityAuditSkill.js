import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { BaseSkill } from './BaseSkill.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const SECRET_PATTERNS = {
    AWS_ACCESS_KEY: /AKIA[0-9A-Z]{16}/g,
    OPENAI_API_KEY: /sk-[a-zA-Z0-9]{32,}/g,
    SUPABASE_JWT: /ey[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
    GENERIC_PRIVATE_KEY: /-----BEGIN (RSA|OPENSSH|DSA|EC|PGP) PRIVATE KEY-----/g,
};

const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'public'];

function scanDirectoryForSecrets(dir, report = []) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            if (!IGNORE_DIRS.includes(file)) {
                scanDirectoryForSecrets(fullPath, report);
            }
        } else if (stat.isFile() && !file.endsWith('.log') && file !== '.env') {
            const content = fs.readFileSync(fullPath, 'utf8');
            for (const [keyType, regex] of Object.entries(SECRET_PATTERNS)) {
                regex.lastIndex = 0;
                if (regex.test(content)) {
                    report.push({
                        severity: 'CRITICAL',
                        type: keyType,
                        file: fullPath.replace(rootDir, ''),
                        message: `Potential ${keyType} found hardcoded in file.`,
                    });
                }
            }
        }
    }
    return report;
}

export const securityAuditSkill = new BaseSkill({
    name: 'securityAudit',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: {
        vulnerabilities: 'array',
        secretsFound: 'array',
        overallHealth: 'string',
    },
    requiresApproval: true,
    execute: async () => {
        const report = { vulnerabilities: [], secretsFound: [], overallHealth: 'OK' };

        try {
            console.log('[SecuritySkill] Running npm audit...');
            const auditOutput = execSync('npm audit --json', { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' });
            const auditData = JSON.parse(auditOutput);
            report.vulnerabilities = auditData.vulnerabilities || [];
        } catch (error) {
            if (error.stdout) {
                try {
                    const auditData = JSON.parse(error.stdout);
                    report.vulnerabilities = auditData.metadata?.vulnerabilities || auditData.vulnerabilities;
                    report.overallHealth = 'WARNING';
                } catch (parseErr) {
                    report.vulnerabilities = [{ error: 'Failed to parse npm audit output.' }];
                }
            }
        }

        console.log('[SecuritySkill] Scanning source files for secrets...');
        const secretReport = scanDirectoryForSecrets(rootDir);
        report.secretsFound = secretReport;

        if (secretReport.length > 0) {
            report.overallHealth = 'CRITICAL';
        }

        return report;
    },
});
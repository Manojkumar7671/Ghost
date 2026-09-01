import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * services/repoInspector.js — V1 Read-Only Repo Inspector for Ghost
 *
 * Owner-initiated, read-only repository mapping with strict canonical root boundaries,
 * symlink skipping, file/depth/byte/time limits, and defensive safe file parsing.
 * NO writes, NO child processes, NO shell execution, NO network, NO LLM calls.
 */

export async function inspectRepo(targetPathInput, options = {}) {
    const startTime = Date.now();

    // 1. Resolve Canonical App Root
    let canonicalRoot;
    try {
        canonicalRoot = fs.realpathSync(process.cwd());
    } catch (err) {
        return {
            success: false,
            error: `Failed to resolve application root: ${err.message}`
        };
    }

    // Determine target path
    const requestedPath = targetPathInput ? path.resolve(targetPathInput) : canonicalRoot;

    // Resolve realpath of requested target
    let canonicalTarget;
    try {
        if (!fs.existsSync(requestedPath)) {
            return {
                success: false,
                error: 'Invalid target repository path: path does not exist.'
            };
        }
        canonicalTarget = fs.realpathSync(requestedPath);
    } catch (err) {
        return {
            success: false,
            error: `Invalid target repository path: ${err.message}`
        };
    }

    // Strict Root Boundary Enforcer: canonicalTarget must equal canonicalRoot or be inside canonicalRoot
    if (canonicalTarget !== canonicalRoot && !canonicalTarget.startsWith(canonicalRoot + path.sep)) {
        return {
            success: false,
            error: 'Access Denied: Inspection restricted to current application repository only.'
        };
    }

    // 2. Limits & Configuration
    const MAX_DEPTH = typeof options.maxDepth === 'number' ? options.maxDepth : 6;
    const MAX_FILES = typeof options.maxFiles === 'number' ? options.maxFiles : 300;
    const MAX_BYTES = typeof options.maxBytes === 'number' ? options.maxBytes : 1024 * 1024; // 1 MB total metadata/text bytes limit
    const MAX_TIME_MS = typeof options.maxTimeMs === 'number' ? options.maxTimeMs : 3000;      // 3 seconds max wall-clock time
    const MAX_SAFE_FILE_SIZE = 64 * 1024; // 64 KB per safe text file

    const EXCLUDED_DIRS = new Set([
        '.git', 'node_modules', 'dist', 'build', 'coverage', '.cache', 'logs',
        'tmp', 'temp', 'uploads', 'downloads'
    ]);

    const EXCLUDED_EXTENSIONS = new Set([
        '.env', '.pem', '.key', '.p12', '.pfx', '.sqlite', '.db', '.log',
        '.sqlite3', '.crt', '.cer', '.der', '.p8'
    ]);

    const ALLOWED_SAFE_FILES = new Set([
        'package.json', 'README.md', 'ARCHITECTURE.md', 'STATUS.md'
    ]);

    let totalFiles = 0;
    let totalDirectories = 0;
    let totalBytes = 0;
    let maxDepthReached = 0;
    let isBoundedPartial = false;
    let limitReason = null;
    let excludedCount = 0;

    const languageCounts = {};
    const architectureMap = {};
    const entryPoints = [];

    // Queue for BFS traversal: { dirPath, depth }
    const queue = [{ dirPath: canonicalTarget, depth: 0 }];

    while (queue.length > 0) {
        // Check wall-clock time limit
        if (Date.now() - startTime >= MAX_TIME_MS) {
            isBoundedPartial = true;
            limitReason = `Time limit of ${MAX_TIME_MS}ms reached`;
            break;
        }

        const current = queue.shift();
        const { dirPath, depth } = current;

        if (depth > maxDepthReached) {
            maxDepthReached = depth;
        }

        if (depth >= MAX_DEPTH) {
            isBoundedPartial = true;
            limitReason = `Maximum recursion depth of ${MAX_DEPTH} reached`;
            continue;
        }

        let entries;
        try {
            entries = fs.readdirSync(dirPath);
        } catch (e) {
            excludedCount++;
            continue;
        }

        for (const item of entries) {
            // Check time limit
            if (Date.now() - startTime >= MAX_TIME_MS) {
                isBoundedPartial = true;
                limitReason = `Time limit of ${MAX_TIME_MS}ms reached`;
                break;
            }

            // Check file/dir count limit
            if (totalFiles + totalDirectories >= MAX_FILES) {
                isBoundedPartial = true;
                limitReason = `Maximum files limit of ${MAX_FILES} reached`;
                break;
            }

            // Check byte limit
            if (totalBytes >= MAX_BYTES) {
                isBoundedPartial = true;
                limitReason = `Maximum byte limit of ${MAX_BYTES / 1024} KB reached`;
                break;
            }

            const itemPath = path.join(dirPath, item);
            const relativePath = path.relative(canonicalRoot, itemPath) || '.';
            const baseName = path.basename(item);

            // 1. Check Symlinks and Special Files via lstat (NEVER follow symlinks)
            let lstat;
            try {
                lstat = fs.lstatSync(itemPath);
            } catch (e) {
                excludedCount++;
                continue;
            }

            if (lstat.isSymbolicLink() || lstat.isFIFO() || lstat.isSocket() || lstat.isBlockDevice() || lstat.isCharacterDevice()) {
                excludedCount++;
                continue;
            }

            // 2. Check Directory Exclusions
            if (lstat.isDirectory()) {
                if (EXCLUDED_DIRS.has(baseName) || (baseName.startsWith('.') && baseName !== '.')) {
                    excludedCount++;
                    continue;
                }

                // Verify realpath of directory stays inside canonical root
                try {
                    const realItemPath = fs.realpathSync(itemPath);
                    if (realItemPath !== canonicalRoot && !realItemPath.startsWith(canonicalRoot + path.sep)) {
                        excludedCount++;
                        continue;
                    }
                } catch (e) {
                    excludedCount++;
                    continue;
                }

                totalDirectories++;

                // Track high-level architecture category for 1st-level directories
                const relParts = relativePath.split(path.sep);
                if (relParts.length === 1) {
                    const category = relParts[0];
                    if (!architectureMap[category]) {
                        architectureMap[category] = { fileCount: 0, dirCount: 0 };
                    }
                    architectureMap[category].dirCount++;
                }

                queue.push({ dirPath: itemPath, depth: depth + 1 });
                continue;
            }

            // 3. Check File Exclusions
            if (lstat.isFile()) {
                const ext = path.extname(baseName).toLowerCase();

                // Exclude hidden files unless whitelisted safe text file
                if (baseName.startsWith('.') && !ALLOWED_SAFE_FILES.has(baseName)) {
                    excludedCount++;
                    continue;
                }

                // Exclude sensitive extensions / env / keys / logs / databases
                if (EXCLUDED_EXTENSIONS.has(ext) || baseName.startsWith('.env') || ext === '.env') {
                    excludedCount++;
                    continue;
                }

                // Verify realpath of file stays inside canonical root
                try {
                    const realItemPath = fs.realpathSync(itemPath);
                    if (realItemPath !== canonicalRoot && !realItemPath.startsWith(canonicalRoot + path.sep)) {
                        excludedCount++;
                        continue;
                    }
                } catch (e) {
                    excludedCount++;
                    continue;
                }

                totalFiles++;
                const fileSize = lstat.size;
                const bytesConsidered = ALLOWED_SAFE_FILES.has(baseName) ? Math.min(fileSize, MAX_SAFE_FILE_SIZE) : Math.min(fileSize, 4096);
                totalBytes += bytesConsidered;

                // Track extension counts
                const cleanExt = ext ? ext.slice(1) : 'no_ext';
                languageCounts[cleanExt] = (languageCounts[cleanExt] || 0) + 1;

                // Track architecture categories
                const relParts = relativePath.split(path.sep);
                if (relParts.length > 1) {
                    const topCategory = relParts[0];
                    if (!architectureMap[topCategory]) {
                        architectureMap[topCategory] = { fileCount: 0, dirCount: 0 };
                    }
                    architectureMap[topCategory].fileCount++;
                }

                // 4. Safe File Inspection (package.json, README.md, ARCHITECTURE.md, STATUS.md)
                if (ALLOWED_SAFE_FILES.has(baseName)) {
                    entryPoints.push({
                        path: relativePath,
                        type: baseName === 'package.json' ? 'manifest' : 'documentation',
                        source: 'file manifest'
                    });

                    if (baseName === 'package.json') {
                        try {
                            const rawStr = fs.readFileSync(itemPath, 'utf-8');
                            const safeStr = rawStr.length > MAX_SAFE_FILE_SIZE ? rawStr.slice(0, MAX_SAFE_FILE_SIZE) : rawStr;
                            const pkgJson = JSON.parse(safeStr);

                            if (pkgJson.main) {
                                entryPoints.push({
                                    path: pkgJson.main,
                                    type: 'main',
                                    source: 'package.json main'
                                });
                            }
                            if (pkgJson.scripts && typeof pkgJson.scripts === 'object') {
                                Object.keys(pkgJson.scripts).forEach(scriptName => {
                                    entryPoints.push({
                                        path: `script: npm run ${scriptName}`,
                                        type: 'script',
                                        source: 'package.json scripts'
                                    });
                                });
                            }
                        } catch (e) {
                            // Defensive parsing error ignore
                        }
                    }
                }
            }
        }

        if (isBoundedPartial) {
            break;
        }
    }

    const elapsedMs = Date.now() - startTime;
    const inspectionId = `repo-insp-${crypto.randomBytes(6).toString('hex')}`;

    return {
        success: true,
        repository: {
            name: 'Ghost',
            root: '.',
            inspectedAt: new Date().toISOString(),
            inspectionId,
            isBoundedPartial,
            limitReason
        },
        summary: {
            totalFiles,
            totalDirectories,
            totalBytes,
            maxDepthReached,
            languageCounts
        },
        entryPoints,
        architectureMap,
        exclusions: {
            categories: [
                '.git', 'node_modules', 'dist', 'build', 'coverage', '.cache', 'logs',
                'tmp', 'temp', 'uploads', 'downloads', 'hidden files/dirs',
                '*.env', '*.pem', '*.key', '*.p12', '*.pfx', '*.sqlite', '*.db', '*.log'
            ],
            excludedCount
        },
        limitsAndEvidence: {
            maxDepthLimit: MAX_DEPTH,
            maxFilesLimit: MAX_FILES,
            maxBytesLimit: MAX_BYTES,
            maxTimeMsLimit: MAX_TIME_MS,
            actualFilesInspected: totalFiles,
            actualDirectoriesInspected: totalDirectories,
            actualBytesProcessed: totalBytes,
            elapsedMs
        },
        disclaimer: 'Read-only map — no commands, file changes, or tests were run.'
    };
}

export default { inspectRepo };

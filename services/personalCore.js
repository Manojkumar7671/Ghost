import crypto from 'crypto';

/**
 * services/personalCore.js — Personal Core V1 for Ghost
 *
 * Core contract:
 * Ghost remembers only what the owner explicitly saves. It never invents,
 * silently extracts, or claims personal memory. The owner can review and
 * remove everything Personal Core stores.
 *
 * NON-NEGOTIABLE BOUNDARIES:
 * - NO silent memory extraction from chats, files, or browser.
 * - NO secret storage: Rejects API keys, tokens, passwords, database URLs.
 * - NO visitor access: Strictly owner-scoped.
 * - NO autonomous execution, child processes, or file system writes.
 * - NO LLM dependency: All summaries and queries are purely deterministic.
 * - NO voice integration: Audio/voice paths are untouched.
 */

export const MAX_MEMORY_CHARS = 500;
export const MAX_GOAL_TITLE_CHARS = 160;
export const MAX_GOAL_NOTE_CHARS = 600;
export const MAX_MEMORIES_LIST = 50;
export const MAX_GOALS_LIST = 30;
export const ALLOWED_GOAL_STATUSES = ['active', 'paused', 'done'];
export const SECRET_REJECTION_MESSAGE = "For safety, Ghost does not store secrets in Personal Core.";

export const MAX_TASK_TITLE_CHARS = 160;
export const MAX_TASK_DESC_CHARS = 1000;
export const MAX_BLOCKER_REASON_CHARS = 500;
export const MAX_TASKS_LIST = 50;
export const MAX_TASK_EVENTS_LIST = 100;
export const ALLOWED_TASK_STATUSES = ['pending', 'planned', 'blocked', 'cancelled'];
export const ALLOWED_TASK_EVENT_TYPES = [
    'task_created',
    'status_changed',
    'blocker_recorded',
    'task_cancelled',
    'agent_proposal_created',
    'agent_proposal_feedback_recorded',
    'approval_contract_drafted',
    'approval_contract_reviewed',
    'approval_contract_cancelled',
    'approval_contract_expired',
    'approval_test_run_started',
    'approval_test_run_cancel_requested',
    'approval_test_run_cancelled',
    'approval_test_run_succeeded',
    'approval_test_run_failed',
    'approval_test_run_timed_out',
    'approval_test_run_rejected'
];

// In-memory fallback repository for resilient, isolated execution & unit testing
const inMemoryStore = {
    memories: new Map(),   // ownerId -> Array<MemoryObject>
    goals: new Map(),      // ownerId -> Array<GoalObject>
    tasks: new Map(),      // ownerId -> Array<TaskObject>
    taskEvents: new Map()  // taskId -> Array<TaskEventObject>
};

/**
 * Reset in-memory store (used for unit testing isolation).
 */
export function resetMemoryStoreForTesting() {
    inMemoryStore.memories.clear();
    inMemoryStore.goals.clear();
    inMemoryStore.tasks.clear();
    inMemoryStore.taskEvents.clear();
    transientTaskProposals.clear();
}

/**
 * Conservative secret detector.
 * Detects API keys, tokens, credentials, connection URIs, and private key headers.
 */
export function isPotentialSecret(text) {
    if (!text || typeof text !== 'string') return false;
    const str = text.trim();

    const secretPatterns = [
        /\bsk-[a-zA-Z0-9_\-]{10,}\b/,                           // OpenAI / general secret keys
        /\bgsk_[a-zA-Z0-9_\-]{10,}\b/,                          // Groq API keys
        /\bAIza[0-9A-Za-z\-_]{20,}\b/,                          // Google API keys
        /\bghp_[a-zA-Z0-9]{15,}\b/,                             // GitHub personal access tokens
        /\bgithub_pat_[a-zA-Z0-9_]{15,}\b/,                     // GitHub fine-grained PAT
        /\bBearer\s+[a-zA-Z0-9\._\-]{15,}\b/i,                  // Bearer tokens
        /-----BEGIN\s+(RSA|DSA|EC|OPENSSH|PGP|PRIVATE\s+KEY)/i,  // Private keys / certs
        /\b(postgres|postgresql|mysql|mongodb|redis|amqp):\/\/[^\s]+/i, // Database URLs with credentials
        /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[^\s"']{4,}/i, // Key/value assignments
        /\bnpm_[a-zA-Z0-9]{20,}\b/,                             // NPM tokens
        /\bxox[baprs]-[a-zA-Z0-9\-]+\b/                         // Slack tokens
    ];

    return secretPatterns.some(pattern => pattern.test(str));
}

/**
 * Sanitizes plain text input.
 */
function sanitizePlainText(input, maxLen) {
    if (typeof input !== 'string') return '';
    const cleaned = input
        .replace(/<[^>]*>/g, '') // Strip HTML tags
        .trim();
    return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

/**
 * Generates a short unique ID for personal records.
 */
function generateRecordId(prefix = 'pc') {
    return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

// --- MEMORY OPERATIONS ---

/**
 * Save an explicit owner memory note.
 */
export async function saveExplicitMemory(ownerId, memoryData, dbPool = null) {
    if (!ownerId || typeof ownerId !== 'string') {
        throw new Error('Valid owner identification required.');
    }

    const rawText = typeof memoryData === 'string' ? memoryData : (memoryData ? (memoryData.text || memoryData.content || '') : '');
    if (typeof rawText !== 'string' || !rawText.trim()) {
        return { success: false, error: 'Memory content cannot be empty.' };
    }

    if (isPotentialSecret(rawText)) {
        return { success: false, error: SECRET_REJECTION_MESSAGE, isSecretRejected: true };
    }

    const trimmedText = sanitizePlainText(rawText, MAX_MEMORY_CHARS);
    if (!trimmedText) {
        return { success: false, error: 'Memory content cannot be empty after sanitization.' };
    }

    const recordId = generateRecordId('mem');
    const now = new Date().toISOString();
    const memoryRecord = {
        id: recordId,
        ownerId: String(ownerId),
        text: trimmedText,
        kind: 'memory',
        createdAt: now,
        updatedAt: now
    };

    // Try DB Pool if operational
    if (dbPool && typeof dbPool.query === 'function') {
        try {
            await dbPool.query(
                `INSERT INTO ghost_memories (id, owner_id, title, content, category, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [recordId, String(ownerId), 'Explicit Memory', trimmedText, 'personal_memory', now, now]
            );
        } catch (dbErr) {
            console.warn('[PersonalCore] DB write failed, using memory store fallback:', dbErr.message);
        }
    }

    // Always maintain in-memory store
    if (!inMemoryStore.memories.has(String(ownerId))) {
        inMemoryStore.memories.set(String(ownerId), []);
    }
    inMemoryStore.memories.get(String(ownerId)).unshift(memoryRecord);

    return {
        success: true,
        memory: memoryRecord
    };
}

/**
 * List explicit memories for an owner.
 */
export async function listExplicitMemories(ownerId, dbPool = null) {
    if (!ownerId || typeof ownerId !== 'string') {
        return [];
    }

    // Check DB Pool first
    if (dbPool && typeof dbPool.query === 'function') {
        try {
            const res = await dbPool.query(
                `SELECT id, owner_id, content, created_at, updated_at
                 FROM ghost_memories
                 WHERE owner_id = $1 AND category = 'personal_memory'
                 ORDER BY created_at DESC
                 LIMIT $2`,
                [String(ownerId), MAX_MEMORIES_LIST]
            );
            if (res && Array.isArray(res.rows) && res.rows.length > 0) {
                return res.rows.map(row => ({
                    id: row.id,
                    ownerId: row.owner_id,
                    text: row.content,
                    kind: 'memory',
                    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
                    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()
                }));
            }
        } catch (dbErr) {
            console.warn('[PersonalCore] DB read failed, using memory store fallback:', dbErr.message);
        }
    }

    const records = inMemoryStore.memories.get(String(ownerId)) || [];
    return records.slice(0, MAX_MEMORIES_LIST);
}

/**
 * Delete an explicit memory.
 */
export async function deleteExplicitMemory(ownerId, memoryId, dbPool = null) {
    if (!ownerId || !memoryId) {
        return { success: false, error: 'Owner ID and Memory ID required.' };
    }

    let deletedFromDb = false;
    if (dbPool && typeof dbPool.query === 'function') {
        try {
            const res = await dbPool.query(
                `DELETE FROM ghost_memories WHERE id = $1 AND owner_id = $2 AND category = 'personal_memory'`,
                [String(memoryId), String(ownerId)]
            );
            deletedFromDb = (res && res.rowCount > 0);
        } catch (dbErr) {
            console.warn('[PersonalCore] DB delete failed:', dbErr.message);
        }
    }

    const records = inMemoryStore.memories.get(String(ownerId)) || [];
    const initialLen = records.length;
    const filtered = records.filter(m => m.id !== memoryId);
    inMemoryStore.memories.set(String(ownerId), filtered);
    const deletedFromMemory = filtered.length < initialLen;

    if (deletedFromDb || deletedFromMemory) {
        return { success: true, message: 'Memory deleted successfully.' };
    }
    return { success: false, error: 'Memory not found or unauthorized.' };
}

// --- GOAL OPERATIONS ---

/**
 * Create an owner goal.
 */
export async function createOwnerGoal(ownerId, goalData, dbPool = null) {
    if (!ownerId || typeof ownerId !== 'string') {
        throw new Error('Valid owner identification required.');
    }

    const rawTitle = goalData ? (goalData.title || '') : '';
    const rawNote = goalData ? (goalData.note || '') : '';
    const rawStatus = goalData && goalData.status ? String(goalData.status).toLowerCase().trim() : 'active';

    if (typeof rawTitle !== 'string' || !rawTitle.trim()) {
        return { success: false, error: 'Goal title cannot be empty.' };
    }

    if (isPotentialSecret(rawTitle) || isPotentialSecret(rawNote)) {
        return { success: false, error: SECRET_REJECTION_MESSAGE, isSecretRejected: true };
    }

    if (!ALLOWED_GOAL_STATUSES.includes(rawStatus)) {
        return { success: false, error: `Invalid status. Must be one of: ${ALLOWED_GOAL_STATUSES.join(', ')}` };
    }

    const title = sanitizePlainText(rawTitle, MAX_GOAL_TITLE_CHARS);
    const note = sanitizePlainText(rawNote, MAX_GOAL_NOTE_CHARS);
    const status = rawStatus;
    const recordId = generateRecordId('goal');
    const now = new Date().toISOString();

    const goalRecord = {
        id: recordId,
        ownerId: String(ownerId),
        title,
        note,
        status,
        kind: 'goal',
        createdAt: now,
        updatedAt: now
    };

    // Try DB Pool if operational
    if (dbPool && typeof dbPool.query === 'function') {
        try {
            const contentJson = JSON.stringify({ note, status });
            await dbPool.query(
                `INSERT INTO ghost_memories (id, owner_id, title, content, category, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [recordId, String(ownerId), title, contentJson, 'personal_goal', now, now]
            );
        } catch (dbErr) {
            console.warn('[PersonalCore] DB write failed for goal:', dbErr.message);
        }
    }

    // Always maintain in-memory store
    if (!inMemoryStore.goals.has(String(ownerId))) {
        inMemoryStore.goals.set(String(ownerId), []);
    }
    inMemoryStore.goals.get(String(ownerId)).unshift(goalRecord);

    return {
        success: true,
        goal: goalRecord
    };
}

/**
 * List owner goals.
 */
export async function listOwnerGoals(ownerId, dbPool = null) {
    if (!ownerId || typeof ownerId !== 'string') {
        return [];
    }

    // Check DB Pool first
    if (dbPool && typeof dbPool.query === 'function') {
        try {
            const res = await dbPool.query(
                `SELECT id, owner_id, title, content, created_at, updated_at
                 FROM ghost_memories
                 WHERE owner_id = $1 AND category = 'personal_goal'
                 ORDER BY created_at DESC
                 LIMIT $2`,
                [String(ownerId), MAX_GOALS_LIST]
            );
            if (res && Array.isArray(res.rows) && res.rows.length > 0) {
                return res.rows.map(row => {
                    let note = '';
                    let status = 'active';
                    try {
                        const parsed = JSON.parse(row.content);
                        if (parsed && typeof parsed === 'object') {
                            note = parsed.note || '';
                            status = parsed.status || 'active';
                        }
                    } catch {
                        note = row.content || '';
                    }
                    return {
                        id: row.id,
                        ownerId: row.owner_id,
                        title: row.title,
                        note,
                        status,
                        kind: 'goal',
                        createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
                        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()
                    };
                });
            }
        } catch (dbErr) {
            console.warn('[PersonalCore] DB read failed for goals:', dbErr.message);
        }
    }

    const records = inMemoryStore.goals.get(String(ownerId)) || [];
    return records.slice(0, MAX_GOALS_LIST);
}

export const listPersonalGoals = listOwnerGoals;

/**
 * Update an owner goal.
 */
export async function updateOwnerGoal(ownerId, goalId, updates, dbPool = null) {
    if (!ownerId || !goalId || !updates || typeof updates !== 'object') {
        return { success: false, error: 'Owner ID, Goal ID, and updates object required.' };
    }

    if ((updates.title && isPotentialSecret(updates.title)) || (updates.note && isPotentialSecret(updates.note))) {
        return { success: false, error: SECRET_REJECTION_MESSAGE, isSecretRejected: true };
    }

    if (updates.status && !ALLOWED_GOAL_STATUSES.includes(String(updates.status).toLowerCase())) {
        return { success: false, error: `Invalid status. Must be one of: ${ALLOWED_GOAL_STATUSES.join(', ')}` };
    }

    const records = inMemoryStore.goals.get(String(ownerId)) || [];
    const existing = records.find(g => g.id === goalId);

    const newTitle = updates.title !== undefined ? sanitizePlainText(updates.title, MAX_GOAL_TITLE_CHARS) : (existing ? existing.title : '');
    const newNote = updates.note !== undefined ? sanitizePlainText(updates.note, MAX_GOAL_NOTE_CHARS) : (existing ? existing.note : '');
    const newStatus = updates.status !== undefined ? String(updates.status).toLowerCase() : (existing ? existing.status : 'active');
    const now = new Date().toISOString();

    if (!newTitle.trim()) {
        return { success: false, error: 'Goal title cannot be empty.' };
    }

    let updatedFromDb = false;
    if (dbPool && typeof dbPool.query === 'function') {
        try {
            const contentJson = JSON.stringify({ note: newNote, status: newStatus });
            const res = await dbPool.query(
                `UPDATE ghost_memories
                 SET title = $1, content = $2, updated_at = $3
                 WHERE id = $4 AND owner_id = $5 AND category = 'personal_goal'`,
                [newTitle, contentJson, now, String(goalId), String(ownerId)]
            );
            updatedFromDb = (res && res.rowCount > 0);
        } catch (dbErr) {
            console.warn('[PersonalCore] DB update failed for goal:', dbErr.message);
        }
    }

    if (existing) {
        existing.title = newTitle;
        existing.note = newNote;
        existing.status = newStatus;
        existing.updatedAt = now;
        return { success: true, goal: existing };
    }

    if (updatedFromDb) {
        const updatedRecord = {
            id: goalId,
            ownerId: String(ownerId),
            title: newTitle,
            note: newNote,
            status: newStatus,
            kind: 'goal',
            createdAt: now,
            updatedAt: now
        };
        return { success: true, goal: updatedRecord };
    }

    return { success: false, error: 'Goal not found or unauthorized.' };
}

/**
 * Delete an owner goal.
 */
export async function deleteOwnerGoal(ownerId, goalId, dbPool = null) {
    if (!ownerId || !goalId) {
        return { success: false, error: 'Owner ID and Goal ID required.' };
    }

    let deletedFromDb = false;
    if (dbPool && typeof dbPool.query === 'function') {
        try {
            const res = await dbPool.query(
                `DELETE FROM ghost_memories WHERE id = $1 AND owner_id = $2 AND category = 'personal_goal'`,
                [String(goalId), String(ownerId)]
            );
            deletedFromDb = (res && res.rowCount > 0);
        } catch (dbErr) {
            console.warn('[PersonalCore] DB delete failed for goal:', dbErr.message);
        }
    }

    const records = inMemoryStore.goals.get(String(ownerId)) || [];
    const initialLen = records.length;
    const filtered = records.filter(g => g.id !== goalId);
    inMemoryStore.goals.set(String(ownerId), filtered);
    const deletedFromMemory = filtered.length < initialLen;

    if (deletedFromDb || deletedFromMemory) {
        return { success: true, message: 'Goal deleted successfully.' };
    }
    return { success: false, error: 'Goal not found or unauthorized.' };
}

// --- TASK LEDGER V1 OPERATIONS (Owner-Visible Tasks & Immutable Activity Ledger) ---

/**
 * Initialize personal task and activity ledger tables if Postgres pool is available.
 */
export async function initPersonalTaskTables(dbPool) {
    if (!dbPool || typeof dbPool.query !== 'function') return;
    try {
        await dbPool.query(`
            CREATE TABLE IF NOT EXISTS ghost_personal_tasks (
                id VARCHAR(255) PRIMARY KEY,
                owner_id VARCHAR(255) NOT NULL,
                goal_id VARCHAR(255),
                title VARCHAR(255) NOT NULL,
                description TEXT,
                status VARCHAR(50) NOT NULL DEFAULT 'pending',
                blocker_reason TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_ghost_personal_tasks_owner ON ghost_personal_tasks (owner_id, status);

            CREATE TABLE IF NOT EXISTS ghost_personal_task_events (
                id VARCHAR(255) PRIMARY KEY,
                task_id VARCHAR(255) NOT NULL,
                owner_id VARCHAR(255) NOT NULL,
                event_type VARCHAR(100) NOT NULL,
                event_detail JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_ghost_personal_task_events_task ON ghost_personal_task_events (task_id, created_at);
        `);
    } catch (err) {
        console.warn('[PersonalCore] Task tables initialization warning:', err.message);
    }
}

/**
 * Create a new owner task with initial status 'pending' and an atomic 'task_created' activity event.
 */
export async function createPersonalTask(ownerId, taskData, dbPool = null) {
    if (!ownerId || typeof ownerId !== 'string') {
        throw new Error('Valid owner identification required.');
    }

    const rawTitle = taskData ? (taskData.title || '') : '';
    const rawDescription = taskData ? (taskData.description || '') : '';
    const rawGoalId = taskData && taskData.goalId ? String(taskData.goalId).trim() : null;

    if (typeof rawTitle !== 'string' || !rawTitle.trim()) {
        return { success: false, error: 'Task title cannot be empty.' };
    }

    if (isPotentialSecret(rawTitle) || isPotentialSecret(rawDescription)) {
        return { success: false, error: SECRET_REJECTION_MESSAGE, isSecretRejected: true };
    }

    const title = sanitizePlainText(rawTitle, MAX_TASK_TITLE_CHARS);
    const description = rawDescription ? sanitizePlainText(rawDescription, MAX_TASK_DESC_CHARS) : null;
    let goalId = rawGoalId;
    let goalTitle = null;

    if (!title) {
        return { success: false, error: 'Task title cannot be empty after sanitization.' };
    }

    // Verify linked goal if provided
    if (goalId) {
        const ownerGoals = await listOwnerGoals(ownerId, dbPool);
        const linkedGoal = ownerGoals.find(g => g.id === goalId);
        if (!linkedGoal) {
            return { success: false, error: 'Linked goal not found or unauthorized.' };
        }
        goalTitle = linkedGoal.title;
    }

    const taskId = generateRecordId('task');
    const eventId = generateRecordId('tevt');
    const now = new Date().toISOString();

    const taskRecord = {
        id: taskId,
        ownerId: String(ownerId),
        goalId: goalId || null,
        goalTitle: goalTitle || null,
        title,
        description: description || null,
        status: 'pending',
        blockerReason: null,
        kind: 'task',
        createdAt: now,
        updatedAt: now
    };

    const eventRecord = {
        id: eventId,
        taskId,
        ownerId: String(ownerId),
        eventType: 'task_created',
        eventDetail: {
            title,
            description: description || null,
            goalId: goalId || null,
            goalTitle: goalTitle || null,
            initialStatus: 'pending'
        },
        createdAt: now
    };

    // Try DB Pool if provided
    if (dbPool && typeof dbPool.query === 'function') {
        try {
            await dbPool.query(
                `INSERT INTO ghost_personal_tasks (id, owner_id, goal_id, title, description, status, blocker_reason, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [taskId, String(ownerId), goalId || null, title, description || null, 'pending', null, now, now]
            );

            await dbPool.query(
                `INSERT INTO ghost_personal_task_events (id, task_id, owner_id, event_type, event_detail, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [eventId, taskId, String(ownerId), 'task_created', JSON.stringify(eventRecord.eventDetail), now]
            );
        } catch (dbErr) {
            console.warn('[PersonalCore] DB write failed for task:', dbErr.message);
            return {
                success: false,
                error: `Durable storage is currently unavailable: ${dbErr.message}`
            };
        }
    }

    // Always maintain in-memory store
    if (!inMemoryStore.tasks.has(String(ownerId))) {
        inMemoryStore.tasks.set(String(ownerId), []);
    }
    inMemoryStore.tasks.get(String(ownerId)).unshift(taskRecord);

    if (!inMemoryStore.taskEvents.has(taskId)) {
        inMemoryStore.taskEvents.set(taskId, []);
    }
    inMemoryStore.taskEvents.get(taskId).push(eventRecord);

    return {
        success: true,
        task: taskRecord,
        event: eventRecord
    };
}

/**
 * List all personal tasks for an authenticated owner (newest first, bounded).
 */
export async function listPersonalTasks(ownerId, dbPool = null) {
    if (!ownerId || typeof ownerId !== 'string') {
        return [];
    }

    if (dbPool && typeof dbPool.query === 'function') {
        try {
            const res = await dbPool.query(
                `SELECT t.id, t.owner_id, t.goal_id, t.title, t.description, t.status, t.blocker_reason, t.created_at, t.updated_at,
                        g.title as goal_title
                 FROM ghost_personal_tasks t
                 LEFT JOIN ghost_memories g ON t.goal_id = g.id AND g.owner_id = t.owner_id AND g.category = 'personal_goal'
                 WHERE t.owner_id = $1
                 ORDER BY t.created_at DESC
                 LIMIT $2`,
                [String(ownerId), MAX_TASKS_LIST]
            );
            if (res && Array.isArray(res.rows) && res.rows.length > 0) {
                return res.rows.map(row => ({
                    id: row.id,
                    ownerId: row.owner_id,
                    goalId: row.goal_id || null,
                    goalTitle: row.goal_title || null,
                    title: row.title,
                    description: row.description || null,
                    status: row.status,
                    blockerReason: row.blocker_reason || null,
                    kind: 'task',
                    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
                    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()
                }));
            }
        } catch (dbErr) {
            console.warn('[PersonalCore] DB read failed for tasks:', dbErr.message);
        }
    }

    const records = inMemoryStore.tasks.get(String(ownerId)) || [];
    return records.slice(0, MAX_TASKS_LIST);
}

/**
 * Update personal task status and atomically record an immutable activity event.
 */
export async function updatePersonalTaskStatus(ownerId, taskId, updates, dbPool = null) {
    if (!ownerId || !taskId || !updates || typeof updates !== 'object') {
        return { success: false, error: 'Owner ID, Task ID, and updates required.' };
    }

    const rawStatus = updates.status !== undefined ? String(updates.status).toLowerCase().trim() : '';
    const rawBlockerReason = updates.blockerReason !== undefined ? String(updates.blockerReason).trim() : '';

    if (!ALLOWED_TASK_STATUSES.includes(rawStatus)) {
        return {
            success: false,
            error: `Invalid task status '${rawStatus}'. Allowed states: ${ALLOWED_TASK_STATUSES.join(', ')}`
        };
    }

    if (rawStatus === 'blocked') {
        if (!rawBlockerReason) {
            return {
                success: false,
                error: 'Blocker reason is required when transitioning a task to blocked.'
            };
        }
        if (isPotentialSecret(rawBlockerReason)) {
            return { success: false, error: SECRET_REJECTION_MESSAGE, isSecretRejected: true };
        }
    } else if (rawBlockerReason && isPotentialSecret(rawBlockerReason)) {
        return { success: false, error: SECRET_REJECTION_MESSAGE, isSecretRejected: true };
    }

    const blockerReason = rawStatus === 'blocked'
        ? sanitizePlainText(rawBlockerReason, MAX_BLOCKER_REASON_CHARS)
        : (rawStatus === 'cancelled' && rawBlockerReason ? sanitizePlainText(rawBlockerReason, MAX_BLOCKER_REASON_CHARS) : null);

    // Retrieve existing task to verify ownership and get fromStatus
    const existingTasks = await listPersonalTasks(ownerId, dbPool);
    const existing = existingTasks.find(t => t.id === taskId);
    if (!existing) {
        return { success: false, error: 'Task not found or unauthorized.' };
    }

    const fromStatus = existing.status;
    const toStatus = rawStatus;
    const now = new Date().toISOString();

    let eventType = 'status_changed';
    let eventDetail = { fromStatus, toStatus };

    if (toStatus === 'blocked') {
        eventType = 'blocker_recorded';
        eventDetail = { fromStatus, toStatus: 'blocked', blockerReason };
    } else if (toStatus === 'cancelled') {
        eventType = 'task_cancelled';
        eventDetail = { fromStatus, toStatus: 'cancelled', reason: blockerReason || null };
    }

    const eventId = generateRecordId('tevt');
    const eventRecord = {
        id: eventId,
        taskId,
        ownerId: String(ownerId),
        eventType,
        eventDetail,
        createdAt: now
    };

    if (dbPool && typeof dbPool.query === 'function') {
        try {
            const updateRes = await dbPool.query(
                `UPDATE ghost_personal_tasks
                 SET status = $1, blocker_reason = $2, updated_at = $3
                 WHERE id = $4 AND owner_id = $5`,
                [toStatus, blockerReason, now, String(taskId), String(ownerId)]
            );
            if (!updateRes || updateRes.rowCount === 0) {
                return { success: false, error: 'Task not found or unauthorized.' };
            }

            await dbPool.query(
                `INSERT INTO ghost_personal_task_events (id, task_id, owner_id, event_type, event_detail, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [eventId, taskId, String(ownerId), eventType, JSON.stringify(eventDetail), now]
            );
        } catch (dbErr) {
            console.warn('[PersonalCore] DB update failed for task status:', dbErr.message);
            return {
                success: false,
                error: `Durable storage update failed: ${dbErr.message}`
            };
        }
    }

    // Update in-memory store
    const memTasks = inMemoryStore.tasks.get(String(ownerId)) || [];
    const memTask = memTasks.find(t => t.id === taskId);
    if (memTask) {
        memTask.status = toStatus;
        memTask.blockerReason = blockerReason;
        memTask.updatedAt = now;
    }

    if (!inMemoryStore.taskEvents.has(taskId)) {
        inMemoryStore.taskEvents.set(taskId, []);
    }
    inMemoryStore.taskEvents.get(taskId).push(eventRecord);

    const updatedTask = {
        ...existing,
        status: toStatus,
        blockerReason,
        updatedAt: now
    };

    return {
        success: true,
        task: updatedTask,
        event: eventRecord
    };
}

/**
 * List all immutable activity ledger events for a specific task (chronological, bounded).
 */
export async function listPersonalTaskEvents(ownerId, taskId, dbPool = null) {
    if (!ownerId || !taskId) {
        return { success: false, error: 'Owner ID and Task ID required.' };
    }

    // Verify task exists and belongs to owner
    const existingTasks = await listPersonalTasks(ownerId, dbPool);
    const existing = existingTasks.find(t => t.id === taskId);
    if (!existing) {
        return { success: false, error: 'Task not found or unauthorized.' };
    }

    if (dbPool && typeof dbPool.query === 'function') {
        try {
            const res = await dbPool.query(
                `SELECT id, task_id, owner_id, event_type, event_detail, created_at
                 FROM ghost_personal_task_events
                 WHERE task_id = $1 AND owner_id = $2
                 ORDER BY created_at ASC
                 LIMIT $3`,
                [String(taskId), String(ownerId), MAX_TASK_EVENTS_LIST]
            );
            if (res && Array.isArray(res.rows)) {
                const events = res.rows.map(row => {
                    let detail = row.event_detail;
                    if (typeof detail === 'string') {
                        try { detail = JSON.parse(detail); } catch { detail = {}; }
                    }
                    return {
                        id: row.id,
                        taskId: row.task_id,
                        ownerId: row.owner_id,
                        eventType: row.event_type,
                        eventDetail: detail || {},
                        createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
                    };
                });
                return { success: true, events };
            }
        } catch (dbErr) {
            console.warn('[PersonalCore] DB read failed for task events:', dbErr.message);
        }
    }

    const events = inMemoryStore.taskEvents.get(String(taskId)) || [];
    return {
        success: true,
        events: events.slice(0, MAX_TASK_EVENTS_LIST)
    };
}

/**
 * Append an immutable activity ledger event for a specific task without modifying task status.
 */
export async function appendPersonalTaskEvent(ownerId, taskId, eventType, eventDetail = {}, dbPool = null) {
    if (!ownerId || !taskId || !eventType) {
        return { success: false, error: 'Owner ID, Task ID, and event type required.' };
    }
    if (!ALLOWED_TASK_EVENT_TYPES.includes(eventType)) {
        return { success: false, error: `Invalid event type '${eventType}'.` };
    }

    // Verify task exists and belongs to owner
    const existingTasks = await listPersonalTasks(ownerId, dbPool);
    const existing = existingTasks.find(t => t.id === taskId);
    if (!existing) {
        return { success: false, error: 'Task not found or unauthorized.' };
    }

    const eventId = generateRecordId('tevt');
    const now = new Date().toISOString();
    const eventRecord = {
        id: eventId,
        taskId: String(taskId),
        ownerId: String(ownerId),
        eventType,
        eventDetail: typeof eventDetail === 'object' && eventDetail !== null ? eventDetail : {},
        createdAt: now
    };

    if (dbPool && typeof dbPool.query === 'function') {
        try {
            await dbPool.query(
                `INSERT INTO ghost_personal_task_events (id, task_id, owner_id, event_type, event_detail, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [eventId, String(taskId), String(ownerId), eventType, JSON.stringify(eventRecord.eventDetail), now]
            );
        } catch (dbErr) {
            console.warn('[PersonalCore] DB append failed for task event:', dbErr.message);
            return {
                success: false,
                error: `Durable storage append failed: ${dbErr.message}`
            };
        }
    }

    if (!inMemoryStore.taskEvents.has(taskId)) {
        inMemoryStore.taskEvents.set(taskId, []);
    }
    inMemoryStore.taskEvents.get(taskId).push(eventRecord);

    return {
        success: true,
        event: eventRecord
    };
}

// --- CONTINUITY & OVERVIEW ---

/**
 * Generates a deterministic continuation summary.
 * No LLM calls; pure honest aggregation of active goals, outstanding tasks, and recent explicit memories.
 */
export function generateContinuationSummary(goals = [], memories = [], tasks = []) {
    const safeGoals = Array.isArray(goals) ? goals : [];
    const safeMemories = Array.isArray(memories) ? memories : [];
    const safeTasks = Array.isArray(tasks) ? tasks : [];

    const activeGoals = safeGoals.filter(g => g.status === 'active');
    const pausedGoals = safeGoals.filter(g => g.status === 'paused');
    const doneGoals = safeGoals.filter(g => g.status === 'done');

    const outstandingTasks = safeTasks.filter(t => ['pending', 'planned', 'blocked'].includes(t.status));
    const recentMemories = safeMemories.slice(0, 5);

    if (safeGoals.length === 0 && safeMemories.length === 0 && safeTasks.length === 0) {
        return "No saved context yet. Save a memory, create a goal, or add a task to establish continuity.";
    }

    const parts = [];

    if (activeGoals.length > 0) {
        parts.push(`Active Goals (${activeGoals.length}):`);
        activeGoals.forEach((g, idx) => {
            const noteSuffix = g.note ? ` — Note: ${g.note}` : '';
            parts.push(`  ${idx + 1}. [Active] ${g.title}${noteSuffix}`);
        });
    } else if (safeGoals.length > 0) {
        parts.push(`Goals (${safeGoals.length} total, 0 active):`);
        if (pausedGoals.length > 0) parts.push(`  • ${pausedGoals.length} paused`);
        if (doneGoals.length > 0) parts.push(`  • ${doneGoals.length} completed`);
    }

    if (outstandingTasks.length > 0) {
        if (parts.length > 0) parts.push('');
        parts.push(`Outstanding Tasks (${outstandingTasks.length}):`);
        outstandingTasks.forEach((t, idx) => {
            const statusLabel = t.status.charAt(0).toUpperCase() + t.status.slice(1);
            let detail = '';
            if (t.status === 'blocked' && t.blockerReason) {
                detail = ` — Blocker: ${t.blockerReason}`;
            } else if (t.goalTitle) {
                detail = ` — Goal: ${t.goalTitle}`;
            }
            parts.push(`  ${idx + 1}. [${statusLabel}] ${t.title}${detail}`);
        });
    }

    if (recentMemories.length > 0) {
        if (parts.length > 0) parts.push('');
        parts.push(`Recent Explicit Memories (${recentMemories.length}):`);
        recentMemories.forEach((m, idx) => {
            parts.push(`  • ${m.text}`);
        });
    }

    return parts.join('\n');
}

/**
 * Get comprehensive Personal Core overview for an owner.
 */
export async function getPersonalOverview(ownerId, dbPool = null) {
    if (!ownerId || typeof ownerId !== 'string') {
        throw new Error('Valid owner identification required.');
    }

    const [goals, memories, tasks] = await Promise.all([
        listOwnerGoals(ownerId, dbPool),
        listExplicitMemories(ownerId, dbPool),
        listPersonalTasks(ownerId, dbPool)
    ]);

    const continuationSummary = generateContinuationSummary(goals, memories, tasks);

    return {
        success: true,
        continuationSummary,
        goals,
        recentMemories: memories.slice(0, 5),
        tasks,
        totalGoals: goals.length,
        totalMemories: memories.length,
        totalTasks: tasks.length
    };
}

// --- CHAT-FIRST TASK MEMORY V0: TRANSIENT PROPOSAL LIFECYCLE ---

export const TASK_PROPOSAL_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
export const PROPOSAL_EXPIRED_MESSAGE = "This task proposal has expired or is no longer available. Please restate your task request in chat.";

// In-memory transient proposal map: proposalId -> { proposalId, ownerId, title, description, createdAt, expiresAt }
const transientTaskProposals = new Map();

/**
 * Lazy cleanup of expired proposals (no background timers or setInterval loops).
 */
function purgeExpiredTaskProposals() {
    const now = Date.now();
    for (const [id, prop] of transientTaskProposals.entries()) {
        if (!prop || !prop.expiresAt || new Date(prop.expiresAt).getTime() <= now) {
            transientTaskProposals.delete(id);
        }
    }
}

/**
 * Reset transient task proposals (for unit testing).
 */
export function resetTaskProposalsForTesting() {
    transientTaskProposals.clear();
}

/**
 * Deterministic regex matcher for explicit task-memory directives.
 * Only triggers for explicit, unambiguous leading phrases from the owner.
 */
export function parseTaskMemoryIntent(message) {
    if (!message || typeof message !== 'string') return null;
    const text = message.trim();
    if (!text) return null;

    // Reject quotes, code fences, third-party descriptions, or casual questions
    if (/^["'`]|```/.test(text)) return null;
    if (/^(what|why|how|who|where|when|can you|could you|is there|are there|tell me|explain)\b/i.test(text)) return null;

    const patterns = [
        /^remember\s+that\s+i\s+(?:need|have)\s+to\s+(.+)$/i,
        /^remember\s+that\s+we\s+(?:need|have)\s+to\s+(.+)$/i,
        /^remember\s+i\s+(?:need|have)\s+to\s+(.+)$/i,
        /^remember\s+to\s+(.+)$/i,
        /^add\s+(?:a\s+)?task\s*:\s*(.+)$/i,
        /^save\s+(?:a\s+)?task\s*:\s*(.+)$/i,
        /^task\s*:\s*(.+)$/i,
        /^remind\s+me\s+to\s+(.+)$/i
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            const rawBody = match[1].trim();
            if (!rawBody) return null;

            let title = rawBody;
            let description = null;
            if (rawBody.includes(' | ')) {
                const parts = rawBody.split(' | ');
                title = parts[0].trim();
                description = parts.slice(1).join(' | ').trim();
            } else if (rawBody.includes(' -- ')) {
                const parts = rawBody.split(' -- ');
                title = parts[0].trim();
                description = parts.slice(1).join(' -- ').trim();
            }

            title = title.replace(/[.;]+$/, '').trim();
            if (!title) return null;

            title = title.charAt(0).toUpperCase() + title.slice(1);

            return {
                title: sanitizePlainText(title, MAX_TASK_TITLE_CHARS),
                description: description ? sanitizePlainText(description, MAX_TASK_DESC_CHARS) : null
            };
        }
    }

    return null;
}

/**
 * Create a transient task proposal from explicit owner input.
 */
export async function createTaskProposal(ownerId, proposalInput) {
    if (!ownerId || typeof ownerId !== 'string') {
        throw new Error('Valid owner identification required.');
    }

    purgeExpiredTaskProposals();

    let title = '';
    let description = null;

    if (proposalInput && proposalInput.text) {
        const parsed = parseTaskMemoryIntent(proposalInput.text);
        if (!parsed) {
            return { success: false, error: 'No explicit task-memory directive recognized.' };
        }
        title = parsed.title;
        description = parsed.description;
    } else if (proposalInput && proposalInput.title) {
        title = sanitizePlainText(proposalInput.title, MAX_TASK_TITLE_CHARS);
        description = proposalInput.description ? sanitizePlainText(proposalInput.description, MAX_TASK_DESC_CHARS) : null;
    }

    if (!title || !title.trim()) {
        return { success: false, error: 'Task title cannot be empty.' };
    }

    // Fail-closed secret screening
    if (isPotentialSecret(title) || (description && isPotentialSecret(description))) {
        return { success: false, error: SECRET_REJECTION_MESSAGE, isSecretRejected: true };
    }

    const proposalId = `tprop_${crypto.randomBytes(8).toString('hex')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TASK_PROPOSAL_EXPIRY_MS).toISOString();

    const proposalRecord = {
        proposalId,
        ownerId: String(ownerId),
        title,
        description: description || null,
        createdAt: now.toISOString(),
        expiresAt
    };

    transientTaskProposals.set(proposalId, proposalRecord);

    return {
        success: true,
        proposal: {
            proposalId,
            title,
            description: description || null,
            expiresAt,
            state: 'proposed'
        }
    };
}

/**
 * Confirm and save a transient task proposal.
 * Removes the proposal from memory BEFORE saving to prevent replay.
 */
export async function confirmTaskProposal(ownerId, proposalId, dbPool = null) {
    if (!ownerId || !proposalId) {
        return {
            success: false,
            reasonCode: 'PROPOSAL_EXPIRED_OR_NOT_FOUND',
            error: PROPOSAL_EXPIRED_MESSAGE
        };
    }

    purgeExpiredTaskProposals();

    const proposal = transientTaskProposals.get(String(proposalId));
    if (!proposal || String(proposal.ownerId) !== String(ownerId)) {
        return {
            success: false,
            reasonCode: 'PROPOSAL_EXPIRED_OR_NOT_FOUND',
            error: PROPOSAL_EXPIRED_MESSAGE
        };
    }

    // One-time consumption: delete immediately from transient store
    transientTaskProposals.delete(String(proposalId));

    // Save strictly using server-stored title/description
    const createResult = await createPersonalTask(ownerId, {
        title: proposal.title,
        description: proposal.description
    }, dbPool);

    if (!createResult.success) {
        return createResult;
    }

    return {
        success: true,
        task: createResult.task,
        message: "Task remembered. No code, tools, or automated actions have been executed."
    };
}

/**
 * Dismiss and purge a transient task proposal.
 */
export async function dismissTaskProposal(ownerId, proposalId) {
    if (!ownerId || !proposalId) {
        return { success: true, message: "Nothing was saved." };
    }

    purgeExpiredTaskProposals();

    const proposal = transientTaskProposals.get(String(proposalId));
    if (proposal && String(proposal.ownerId) === String(ownerId)) {
        transientTaskProposals.delete(String(proposalId));
    }

    return {
        success: true,
        message: "Nothing was saved."
    };
}

import cron from 'node-cron';

export function startAutoLearning(ghostLearnFn, pool) {
    const SCHEDULE = '*/30 * * * *';

    cron.schedule(SCHEDULE, async () => {
        try {
            console.log('[ghostLearn] auto-run starting...');
            if (!pool) return;

            const { rows } = await pool.query(
                'SELECT * FROM user_memories ORDER BY updated_at DESC LIMIT 20'
            );

            if (!rows.length) {
                console.log('[ghostLearn] no new data, skipping this cycle.');
                return;
            }

            console.log(`[ghostLearn] [${new Date().toISOString()}] [TriggerSource: auto-scheduler] Starting learning review loop for ${rows.length} memory rows`);
            for (const row of rows) {
                console.log(`[ghostLearn] [${new Date().toISOString()}] Reviewing memory for user: ${row.username}`);
                await ghostLearnFn({
                    safeUser: row.username,
                    message: 'auto-review',
                    actionTaken: 'auto_learn_cycle'
                });
                await new Promise(resolve => setTimeout(resolve, 50)); // Explicitly yield to event loop
            }

            console.log('[ghostLearn] auto-run complete.', rows.length, 'users reviewed.');
        } catch (err) {
            console.error('[ghostLearn] auto-run failed:', err.message);
        }
    });

    console.log(`[ghostLearn] scheduler started — running on "${SCHEDULE}"`);
}

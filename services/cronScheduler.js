/**
 * services/cronScheduler.js - Lightweight Background Cron Task Scheduler for Ghost
 *
 * Runs scheduled autonomous background tasks (e.g. daily system pulse/health check)
 * without blocking Express server boot or user chat interactions.
 */

import cron from 'node-cron';

let isSchedulerRunning = false;

/**
 * Initializes scheduled background tasks.
 */
export async function sendDesktopNotification(title, message) {
  try {
    await fetch('http://localhost:3000/api/desktop/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, message })
    });
  } catch (e) {}
}

export function initCronScheduler() {
  if (isSchedulerRunning) return;
  isSchedulerRunning = true;

  const HEALTH_CHECK_CRON = '0 0 * * *';
  cron.schedule(HEALTH_CHECK_CRON, async () => {
    try {
      console.log(`[CronScheduler] ⏰ Running scheduled daily system health-check...`);
      const memoryUsage = process.memoryUsage();
      const uptimeSec = Math.floor(process.uptime());
      const statusMsg = `Uptime: ${uptimeSec}s, RSS: ${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`;
      console.log(`[CronScheduler] ✅ Health Check OK — ${statusMsg}`);
      await sendDesktopNotification('Ghost AI Health Check', statusMsg);
    } catch (err) {
      console.error('[CronScheduler] ❌ Health check task error:', err.message);
    }
  });

  console.log(`[CronScheduler] Background task scheduler initialized ("${HEALTH_CHECK_CRON}")`);
}

export default {
  initCronScheduler,
  sendDesktopNotification
};

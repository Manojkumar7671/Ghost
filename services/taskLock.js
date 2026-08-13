/**
 * taskLock.js
 * In-memory task claim / lock mechanism to prevent double-execution across agents.
 */

const activeLocks = new Set();

export function claimTask(taskId) {
  if (!taskId) return true;
  if (activeLocks.has(taskId)) {
    return false; // Already claimed by another execution
  }
  activeLocks.add(taskId);
  return true;
}

export function releaseTask(taskId) {
  if (taskId) activeLocks.delete(taskId);
}

export function isTaskClaimed(taskId) {
  return activeLocks.has(taskId);
}

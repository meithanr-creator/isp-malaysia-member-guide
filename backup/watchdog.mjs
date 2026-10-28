import { writeSync } from 'node:fs';
export const PROCESS_LIMIT_MS = 1680000;

// Hard exit closes this process's streams and SDK polling without running lease-release finally blocks.
// A managed export already accepted by Google can continue remotely; durable intent must be reconciled.
export function startProcessWatchdog(phase, timeoutMs = PROCESS_LIMIT_MS) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > PROCESS_LIMIT_MS) throw Error('WATCHDOG_LIMIT_INVALID');
  const expiresAt = Date.now() + timeoutMs;
  let stopped = false;
  function expire() {
    if (stopped) return;
    const candidate = phase();
    const failedPhase = typeof candidate === 'string' && /^[a-z-]{1,40}$/.test(candidate) ? candidate : 'unknown';
    try {
      writeSync(2, JSON.stringify({ kind: 'isp-planter-backup-v1', phase: 'failed', failedPhase, code: 'JOB_DEADLINE_REACHED', jobSucceeded: false, checkpointsRetained: true, leaseRetained: true, remoteExportMayContinue: true }) + '\n');
    } finally { process.exit(124); }
  }
  const timer = setTimeout(expire, timeoutMs);
  return {
    expiresAt,
    remaining() { if (Date.now() >= expiresAt) expire(); return Math.max(1, expiresAt - Date.now()); },
    stop() { stopped = true; clearTimeout(timer); },
  };
}

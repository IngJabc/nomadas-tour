import { env } from '../config/env.js';
export { retryDelayMs } from './outbox/retry.js';

export interface WorkerRuntimeConfig {
  pollMs: number;
  batchSize: number;
  maxAttempts: number;
  settleMs: number;
  retryBaseMs: number;
  emailViaOutbox: boolean;
  tripReminderViaOutbox: boolean;
  reminderSchedulePollMs: number;
  reminderScheduleBatch: number;
  heartbeatMs: number;
  staleProcessingMs: number;
  staleRecoveryLimit: number;
  recoveryIntervalMs: number;
  healthPort: number;
}

export function getWorkerRuntimeConfig(): WorkerRuntimeConfig {
  return {
    pollMs: env.OUTBOX_POLL_MS,
    batchSize: env.OUTBOX_BATCH_SIZE,
    maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
    settleMs: env.OUTBOX_SETTLE_MS,
    retryBaseMs: env.OUTBOX_RETRY_BASE_MS,
    emailViaOutbox: env.EMAIL_VIA_OUTBOX,
    tripReminderViaOutbox: env.TRIP_REMINDER_VIA_OUTBOX,
    reminderSchedulePollMs: env.REMINDER_SCHEDULE_POLL_MS,
    reminderScheduleBatch: env.REMINDER_SCHEDULE_BATCH,
    heartbeatMs: env.OUTBOX_HEARTBEAT_MS,
    staleProcessingMs: env.OUTBOX_STALE_PROCESSING_MS,
    staleRecoveryLimit: env.OUTBOX_STALE_RECOVERY_LIMIT,
    recoveryIntervalMs: env.OUTBOX_RECOVERY_INTERVAL_MS,
    healthPort: env.WORKER_HEALTH_PORT,
  };
}

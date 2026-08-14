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
  outboxRetentionViaWorker: boolean;
  outboxRetentionPollMs: number;
  outboxRetentionBatch: number;
  outboxRetentionDays: number;
  agencyDigestViaWorker: boolean;
  agencyDigestPollMs: number;
  agencyDigestBatch: number;
  superadminDigestViaWorker: boolean;
  superadminDigestPollMs: number;
  superadminDigestBatch: number;
  occupancyAlertViaWorker: boolean;
  occupancyAlertPollMs: number;
  occupancyAlertBatch: number;
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
    outboxRetentionViaWorker: env.OUTBOX_RETENTION_VIA_WORKER,
    outboxRetentionPollMs: env.OUTBOX_RETENTION_POLL_MS,
    outboxRetentionBatch: env.OUTBOX_RETENTION_BATCH,
    outboxRetentionDays: env.OUTBOX_RETENTION_DAYS,
    agencyDigestViaWorker: env.AGENCY_DIGEST_VIA_WORKER,
    agencyDigestPollMs: env.AGENCY_DIGEST_POLL_MS,
    agencyDigestBatch: env.AGENCY_DIGEST_BATCH,
    superadminDigestViaWorker: env.SUPERADMIN_DIGEST_VIA_WORKER,
    superadminDigestPollMs: env.SUPERADMIN_DIGEST_POLL_MS,
    superadminDigestBatch: env.SUPERADMIN_DIGEST_BATCH,
    occupancyAlertViaWorker: env.OCCUPANCY_ALERT_VIA_WORKER,
    occupancyAlertPollMs: env.OCCUPANCY_ALERT_POLL_MS,
    occupancyAlertBatch: env.OCCUPANCY_ALERT_BATCH,
    heartbeatMs: env.OUTBOX_HEARTBEAT_MS,
    staleProcessingMs: env.OUTBOX_STALE_PROCESSING_MS,
    staleRecoveryLimit: env.OUTBOX_STALE_RECOVERY_LIMIT,
    recoveryIntervalMs: env.OUTBOX_RECOVERY_INTERVAL_MS,
    healthPort: env.WORKER_HEALTH_PORT,
  };
}

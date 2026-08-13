import 'dotenv/config';
import { initSentryFromEnv } from '../observability/init-from-env.js';
import {
  captureException,
  flushSentry,
  fingerprintWorkerFailure,
} from '../observability/sentry.js';
import { getWorkerRuntimeConfig } from './config.js';
import {
  claimOutboxEvents,
  markOutboxCompleted,
  markOutboxFailed,
  markOutboxRequeue,
  recoverStuckOutboxEvents,
} from './outbox/claim.js';
import { runOutboxRelayLoop } from './outbox/relay.js';
import { buildDefaultHandlers, resolveHandler } from './handlers/index.js';
import {
  createDefaultReminderSchedulerDeps,
  startReminderScheduler,
} from './reminder-scheduler.js';
import {
  createDefaultRetentionSchedulerDeps,
  startRetentionScheduler,
} from './retention-scheduler.js';
import {
  createDefaultDigestSchedulerDeps,
  startDigestScheduler,
} from './digest-scheduler.js';
import {
  createDefaultSuperadminDigestSchedulerDeps,
  startSuperadminDigestScheduler,
} from './superadmin-digest-scheduler.js';
import {
  DEFAULT_WORKER_NAME,
  createHeartbeatController,
  createRecoveryScheduler,
  createWorkerLogger,
  createWorkerMetrics,
  getWorkerVersion,
  startWorkerHealthServer,
  type WorkerHealthServer,
} from './observability/index.js';

const config = getWorkerRuntimeConfig();
const handlers = buildDefaultHandlers();
const workerName = DEFAULT_WORKER_NAME;
const workerVersion = getWorkerVersion();
const startedAt = new Date();

initSentryFromEnv('worker', {
  worker_name: workerName,
});

const logger = createWorkerLogger({ workerName });
const metrics = createWorkerMetrics();
const heartbeat = createHeartbeatController({
  logger,
  metrics,
  intervalMs: Math.max(config.heartbeatMs, config.pollMs),
  startedAt,
  processId: process.pid,
  workerVersion,
});
const recoveryScheduler = createRecoveryScheduler({
  intervalMs: config.recoveryIntervalMs,
});

const controller = new AbortController();
let shuttingDown = false;
let healthServer: WorkerHealthServer | null = null;

async function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('worker_shutdown', {
    status: 'stopping',
    signal,
    metrics: metrics.snapshot(),
  });

  controller.abort();

  if (healthServer) {
    try {
      await healthServer.close();
      logger.info('worker_health_server_stopped', { status: 'stopped' });
    } catch (err) {
      logger.error('worker_health_server_stop_error', {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    healthServer = null;
  }

  await flushSentry(2000);
  // Allow the loop to unwind; force exit if it hangs.
  setTimeout(() => process.exit(exitCode), 5_000).unref?.();
}

process.on('SIGINT', () => {
  void shutdown('SIGINT', 0);
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM', 0);
});

process.on('uncaughtException', (err) => {
  metrics.markError();
  logger.error('worker_uncaught_exception', {
    status: 'fatal',
    error: err instanceof Error ? err.message : String(err),
    metrics: metrics.snapshot(),
  });
  captureException(err, {
    tags: {
      service: 'worker',
      worker_name: workerName,
      status: 'fatal',
    },
    fingerprint: fingerprintWorkerFailure(workerName, 'lifecycle'),
    level: 'fatal',
  });
  void flushSentry(2000).finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  metrics.markError();
  const error =
    reason instanceof Error ? reason.message : String(reason);
  logger.error('worker_unhandled_rejection', {
    status: 'fatal',
    error,
    metrics: metrics.snapshot(),
  });
  captureException(reason, {
    tags: {
      service: 'worker',
      worker_name: workerName,
      status: 'fatal',
    },
    fingerprint: fingerprintWorkerFailure(workerName, 'lifecycle'),
    level: 'fatal',
  });
  void flushSentry(2000).finally(() => process.exit(1));
});

async function main() {
  healthServer = await startWorkerHealthServer({
    port: config.healthPort,
    workerName,
    workerVersion,
    startedAt,
    pid: process.pid,
  });

  logger.info('worker_health_server_started', {
    status: 'started',
    port: healthServer.port,
  });

  logger.info('worker_started', {
    status: 'started',
    worker_version: workerVersion,
    process_id: process.pid,
    email_via_outbox: config.emailViaOutbox,
    trip_reminder_via_outbox: config.tripReminderViaOutbox,
    reminder_schedule_poll_ms: config.reminderSchedulePollMs,
    reminder_schedule_batch: config.reminderScheduleBatch,
    outbox_retention_via_worker: config.outboxRetentionViaWorker,
    outbox_retention_poll_ms: config.outboxRetentionPollMs,
    outbox_retention_batch: config.outboxRetentionBatch,
    outbox_retention_days: config.outboxRetentionDays,
    agency_digest_via_worker: config.agencyDigestViaWorker,
    agency_digest_poll_ms: config.agencyDigestPollMs,
    agency_digest_batch: config.agencyDigestBatch,
    superadmin_digest_via_worker: config.superadminDigestViaWorker,
    superadmin_digest_poll_ms: config.superadminDigestPollMs,
    superadmin_digest_batch: config.superadminDigestBatch,
    poll_ms: config.pollMs,
    batch_size: config.batchSize,
    settle_ms: config.settleMs,
    max_attempts: config.maxAttempts,
    heartbeat_ms: config.heartbeatMs,
    stale_processing_ms: config.staleProcessingMs,
    recovery_interval_ms: config.recoveryIntervalMs,
    health_port: healthServer.port,
  });

  // Immediate heartbeat so ops can see liveness without waiting for interval.
  heartbeat.maybeEmit(true);

  // WKR-008 — reminder scheduler runs in parallel; errors never kill the relay.
  const reminderScheduler = startReminderScheduler(
    controller.signal,
    createDefaultReminderSchedulerDeps(logger),
  );

  // WKR-009 — retention scheduler runs in parallel; errors never kill the relay.
  const retentionScheduler = startRetentionScheduler(
    controller.signal,
    createDefaultRetentionSchedulerDeps(logger),
  );

  // F4-001 — agency digest scheduler runs in parallel; errors never kill the relay.
  const digestScheduler = startDigestScheduler(
    controller.signal,
    createDefaultDigestSchedulerDeps(logger),
  );

  // F4-002 — superadmin digest scheduler runs in parallel; errors never kill the relay.
  const superadminDigestScheduler = startSuperadminDigestScheduler(
    controller.signal,
    createDefaultSuperadminDigestSchedulerDeps(logger),
  );

  try {
    await runOutboxRelayLoop(
      {
        claimEvents: claimOutboxEvents,
        markCompleted: markOutboxCompleted,
        markFailed: markOutboxFailed,
        markRequeue: markOutboxRequeue,
        recoverStuck: async () => {
          if (!recoveryScheduler.shouldRun()) {
            return 0;
          }
          recoveryScheduler.markRan();
          const rows = await recoverStuckOutboxEvents(
            config.staleProcessingMs,
            config.staleRecoveryLimit,
          );
          return rows.length;
        },
        getHandler: (type, version) => resolveHandler(handlers, type, version),
        maxAttempts: config.maxAttempts,
        retryBaseMs: config.retryBaseMs,
        batchSize: config.batchSize,
        pollMs: config.pollMs,
        eventType: null,
        logger,
        metrics,
      },
      {
        signal: controller.signal,
        onLoopTick: () => {
          heartbeat.maybeEmit(false);
        },
      },
    );

    await Promise.all([
      reminderScheduler.done,
      retentionScheduler.done,
      digestScheduler.done,
      superadminDigestScheduler.done,
    ]);

    logger.info('worker_stopped', {
      status: 'stopped',
      metrics: metrics.snapshot(),
    });
    if (healthServer) {
      await healthServer.close();
      logger.info('worker_health_server_stopped', { status: 'stopped' });
      healthServer = null;
    }
    await flushSentry(2000);
    process.exit(0);
  } catch (err) {
    metrics.markError();
    logger.error('worker_fatal', {
      status: 'fatal',
      error: err instanceof Error ? err.message : String(err),
      metrics: metrics.snapshot(),
    });
    captureException(err, {
      tags: {
        service: 'worker',
        worker_name: workerName,
        status: 'fatal',
      },
      fingerprint: fingerprintWorkerFailure(workerName, 'lifecycle'),
      level: 'fatal',
    });
    if (healthServer) {
      try {
        await healthServer.close();
        logger.info('worker_health_server_stopped', { status: 'stopped' });
      } catch {
        // ignore close errors on fatal path
      }
      healthServer = null;
    }
    await flushSentry(2000);
    process.exit(1);
  }
}

void main().catch(async (err) => {
  logger.error('worker_fatal', {
    status: 'fatal',
    error: err instanceof Error ? err.message : String(err),
  });
  captureException(err, {
    tags: { service: 'worker', worker_name: workerName, status: 'fatal' },
    fingerprint: fingerprintWorkerFailure(workerName, 'lifecycle'),
    level: 'fatal',
  });
  await flushSentry(2000);
  process.exit(1);
});

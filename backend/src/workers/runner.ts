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
  DEFAULT_WORKER_NAME,
  createHeartbeatController,
  createRecoveryScheduler,
  createWorkerLogger,
  createWorkerMetrics,
  getWorkerVersion,
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

async function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('worker_shutdown', {
    status: 'stopping',
    signal,
    metrics: metrics.snapshot(),
  });
  controller.abort();
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

logger.info('worker_started', {
  status: 'started',
  worker_version: workerVersion,
  process_id: process.pid,
  email_via_outbox: config.emailViaOutbox,
  poll_ms: config.pollMs,
  batch_size: config.batchSize,
  settle_ms: config.settleMs,
  max_attempts: config.maxAttempts,
  heartbeat_ms: config.heartbeatMs,
  stale_processing_ms: config.staleProcessingMs,
  recovery_interval_ms: config.recoveryIntervalMs,
});

// Immediate heartbeat so ops can see liveness without waiting for interval.
heartbeat.maybeEmit(true);

runOutboxRelayLoop(
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
    eventType: 'reservation.created',
    logger,
    metrics,
  },
  {
    signal: controller.signal,
    onLoopTick: () => {
      heartbeat.maybeEmit(false);
    },
  },
)
  .then(async () => {
    logger.info('worker_stopped', {
      status: 'stopped',
      metrics: metrics.snapshot(),
    });
    await flushSentry(2000);
    process.exit(0);
  })
  .catch(async (err) => {
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
    await flushSentry(2000);
    process.exit(1);
  });

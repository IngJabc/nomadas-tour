import 'dotenv/config';
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

function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('worker_shutdown', {
    status: 'stopping',
    signal,
    metrics: metrics.snapshot(),
  });
  controller.abort();
  // Allow the loop to unwind; force exit if it hangs.
  setTimeout(() => process.exit(exitCode), 5_000).unref?.();
}

process.on('SIGINT', () => shutdown('SIGINT', 0));
process.on('SIGTERM', () => shutdown('SIGTERM', 0));

process.on('uncaughtException', (err) => {
  metrics.markError();
  logger.error('worker_uncaught_exception', {
    status: 'fatal',
    error: err instanceof Error ? err.message : String(err),
    metrics: metrics.snapshot(),
  });
  shutdown('uncaughtException', 1);
  process.exit(1);
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
  shutdown('unhandledRejection', 1);
  process.exit(1);
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
  .then(() => {
    logger.info('worker_stopped', {
      status: 'stopped',
      metrics: metrics.snapshot(),
    });
    process.exit(shuttingDown ? 0 : 0);
  })
  .catch((err) => {
    metrics.markError();
    logger.error('worker_fatal', {
      status: 'fatal',
      error: err instanceof Error ? err.message : String(err),
      metrics: metrics.snapshot(),
    });
    process.exit(1);
  });

export {
  correlationFromRow,
  handlerKey,
  type OutboxCorrelationFields,
} from './context.js';
export {
  createWorkerLogger,
  parseWorkerLogLine,
  type WorkerLogFields,
  type WorkerLogLevel,
  type WorkerLogger,
} from './logger.js';
export {
  averageProcessingDurationMs,
  createWorkerMetrics,
  type WorkerMetrics,
  type WorkerMetricsSnapshot,
} from './metrics.js';
export {
  createHeartbeatController,
  type HeartbeatController,
  type HeartbeatState,
} from './heartbeat.js';
export {
  createRecoveryScheduler,
  type RecoveryScheduler,
} from './recovery-scheduler.js';
export { getWorkerVersion } from './version.js';

export const DEFAULT_WORKER_NAME = 'nomadas-outbox-relay';

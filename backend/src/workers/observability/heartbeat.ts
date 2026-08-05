import type { WorkerLogger } from './logger.js';
import type { WorkerMetrics, WorkerMetricsSnapshot } from './metrics.js';

export interface HeartbeatState {
  lastHeartbeatAt: Date | null;
  beatCount: number;
}

export interface HeartbeatController {
  /** Record liveness (call each loop iteration). */
  touch(): void;
  /** Emit structured heartbeat if interval elapsed. Returns true if logged. */
  maybeEmit(force?: boolean): boolean;
  getState(): HeartbeatState;
  isAlive(maxAgeMs: number, now?: Date): boolean;
}

export interface CreateHeartbeatOptions {
  logger: WorkerLogger;
  metrics: WorkerMetrics;
  intervalMs: number;
  /** Process start time for uptime_seconds. */
  startedAt?: Date;
  processId?: number;
  workerVersion?: string;
  now?: () => Date;
  extraFields?: () => Record<string, unknown>;
}

function metricsPayload(snap: WorkerMetricsSnapshot) {
  return {
    events_processed_total: snap.events_processed_total,
    events_failed_total: snap.events_failed_total,
    events_retried_total: snap.events_retried_total,
    events_skipped_total: snap.events_skipped_total,
    current_processing_count: snap.current_processing_count,
    last_processing_duration_ms: snap.last_processing_duration_ms,
    last_success_at: snap.last_success_at,
    last_error_at: snap.last_error_at,
  };
}

export function createHeartbeatController(
  options: CreateHeartbeatOptions,
): HeartbeatController {
  const nowFn = options.now ?? (() => new Date());
  const startedAt = options.startedAt ?? nowFn();
  const processId = options.processId ?? process.pid;
  const workerVersion = options.workerVersion ?? 'unknown';
  let lastHeartbeatAt: Date | null = null;
  let lastEmitAt: Date | null = null;
  let beatCount = 0;

  function touch() {
    lastHeartbeatAt = nowFn();
  }

  return {
    touch,
    maybeEmit(force = false) {
      const now = nowFn();
      touch();
      if (
        !force &&
        lastEmitAt &&
        now.getTime() - lastEmitAt.getTime() < options.intervalMs
      ) {
        return false;
      }
      lastEmitAt = now;
      beatCount += 1;
      const snap = options.metrics.snapshot();
      const uptime_seconds = Math.max(
        0,
        Math.floor((now.getTime() - startedAt.getTime()) / 1000),
      );
      options.logger.info('worker_heartbeat', {
        status: 'alive',
        beat_count: beatCount,
        last_heartbeat_at: now.toISOString(),
        uptime_seconds,
        process_id: processId,
        worker_version: workerVersion,
        metrics: metricsPayload(snap),
        ...(options.extraFields?.() ?? {}),
      });
      return true;
    },
    getState() {
      return { lastHeartbeatAt, beatCount };
    },
    isAlive(maxAgeMs, now) {
      if (!lastHeartbeatAt) return false;
      const t = (now ?? nowFn()).getTime();
      return t - lastHeartbeatAt.getTime() <= maxAgeMs;
    },
  };
}

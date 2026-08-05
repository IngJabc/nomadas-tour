export interface WorkerMetricsSnapshot {
  events_processed_total: number;
  events_failed_total: number;
  events_retried_total: number;
  events_skipped_total: number;
  current_processing_count: number;
  last_processing_duration_ms: number | null;
  last_success_at: string | null;
  last_error_at: string | null;
  /** Running count of duration samples (for avg if needed). */
  processing_duration_samples: number;
  /** Sum of durations for average = sum / samples. */
  processing_duration_sum_ms: number;
}

export interface WorkerMetrics {
  incProcessed(): void;
  incFailed(): void;
  incRetried(): void;
  incSkipped(): void;
  beginProcessing(): void;
  endProcessing(durationMs: number): void;
  observeDuration(durationMs: number): void;
  markSuccess(at?: Date): void;
  markError(at?: Date): void;
  snapshot(): WorkerMetricsSnapshot;
  reset(): void;
}

export function createWorkerMetrics(now: () => Date = () => new Date()): WorkerMetrics {
  let events_processed_total = 0;
  let events_failed_total = 0;
  let events_retried_total = 0;
  let events_skipped_total = 0;
  let current_processing_count = 0;
  let last_processing_duration_ms: number | null = null;
  let last_success_at: string | null = null;
  let last_error_at: string | null = null;
  let processing_duration_samples = 0;
  let processing_duration_sum_ms = 0;

  return {
    incProcessed() {
      events_processed_total += 1;
      last_success_at = now().toISOString();
    },
    incFailed() {
      events_failed_total += 1;
      last_error_at = now().toISOString();
    },
    incRetried() {
      events_retried_total += 1;
    },
    incSkipped() {
      events_skipped_total += 1;
    },
    beginProcessing() {
      current_processing_count += 1;
    },
    endProcessing(durationMs: number) {
      current_processing_count = Math.max(0, current_processing_count - 1);
      last_processing_duration_ms = durationMs;
      processing_duration_samples += 1;
      processing_duration_sum_ms += durationMs;
    },
    observeDuration(durationMs: number) {
      last_processing_duration_ms = durationMs;
      processing_duration_samples += 1;
      processing_duration_sum_ms += durationMs;
    },
    markSuccess(at) {
      last_success_at = (at ?? now()).toISOString();
    },
    markError(at) {
      last_error_at = (at ?? now()).toISOString();
    },
    snapshot() {
      return {
        events_processed_total,
        events_failed_total,
        events_retried_total,
        events_skipped_total,
        current_processing_count,
        last_processing_duration_ms,
        last_success_at,
        last_error_at,
        processing_duration_samples,
        processing_duration_sum_ms,
      };
    },
    reset() {
      events_processed_total = 0;
      events_failed_total = 0;
      events_retried_total = 0;
      events_skipped_total = 0;
      current_processing_count = 0;
      last_processing_duration_ms = null;
      last_success_at = null;
      last_error_at = null;
      processing_duration_samples = 0;
      processing_duration_sum_ms = 0;
    },
  };
}

/** Average processing duration from snapshot (null if no samples). */
export function averageProcessingDurationMs(
  snap: WorkerMetricsSnapshot,
): number | null {
  if (snap.processing_duration_samples === 0) return null;
  return snap.processing_duration_sum_ms / snap.processing_duration_samples;
}

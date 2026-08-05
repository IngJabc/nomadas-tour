import { describe, expect, it } from 'vitest';
import { createWorkerMetrics } from './metrics.js';

describe('WKR-006.1 — Worker metrics', () => {
  it('increments processed / failed / retried / skipped', () => {
    const m = createWorkerMetrics(() => new Date('2026-08-05T15:00:00.000Z'));
    m.incProcessed();
    m.incProcessed();
    m.incSkipped();
    m.incFailed();
    m.incRetried();
    m.incRetried();

    expect(m.snapshot()).toMatchObject({
      events_processed_total: 2,
      events_failed_total: 1,
      events_retried_total: 2,
      events_skipped_total: 1,
      current_processing_count: 0,
      last_success_at: '2026-08-05T15:00:00.000Z',
      last_error_at: '2026-08-05T15:00:00.000Z',
    });
  });

  it('tracks current_processing_count and duration', () => {
    const m = createWorkerMetrics();
    m.beginProcessing();
    expect(m.snapshot().current_processing_count).toBe(1);
    m.endProcessing(120);
    const snap = m.snapshot();
    expect(snap.current_processing_count).toBe(0);
    expect(snap.last_processing_duration_ms).toBe(120);
    expect(snap.processing_duration_samples).toBe(1);
    expect(snap.processing_duration_sum_ms).toBe(120);
  });

  it('markError updates last_error_at without incrementing failed', () => {
    const m = createWorkerMetrics(() => new Date('2026-08-05T16:00:00.000Z'));
    m.markError();
    expect(m.snapshot().last_error_at).toBe('2026-08-05T16:00:00.000Z');
    expect(m.snapshot().events_failed_total).toBe(0);
  });
});

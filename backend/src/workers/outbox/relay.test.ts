import { describe, expect, it, vi } from 'vitest';
import type { OutboxEventRow } from '../../events/types.js';
import { createWorkerMetrics } from '../observability/metrics.js';
import { createWorkerLogger, parseWorkerLogLine } from '../observability/logger.js';
import { processClaimedEvent, runOutboxRelayOnce } from './relay.js';
import type { RelayDeps } from './types.js';

function row(overrides: Partial<OutboxEventRow> = {}): OutboxEventRow {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    event_type: 'reservation.created',
    event_version: 1,
    aggregate_type: 'reservation',
    aggregate_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    tenant_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    payload: {
      reservation_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      trip_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      agency_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    },
    status: 'processing',
    attempts: 1,
    available_at: '2026-08-05T12:00:00.000Z',
    processed_at: null,
    error_message: null,
    created_at: '2026-08-05T12:00:00.000Z',
    updated_at: '2026-08-05T12:00:00.000Z',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<RelayDeps> = {}): RelayDeps {
  return {
    claimEvents: vi.fn(async () => []),
    markCompleted: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    markRequeue: vi.fn(async () => undefined),
    getHandler: vi.fn(() => async () => ({ kind: 'completed', reason: 'sent' })),
    maxAttempts: 5,
    retryBaseMs: 1000,
    now: () => new Date('2026-08-05T12:00:00.000Z'),
    ...overrides,
  };
}

describe('WKR-005 — Outbox relay', () => {
  it('marks completed when handler succeeds', async () => {
    const deps = makeDeps();
    await processClaimedEvent(row(), deps);
    expect(deps.markCompleted).toHaveBeenCalledWith(row().id);
    expect(deps.markFailed).not.toHaveBeenCalled();
    expect(deps.markRequeue).not.toHaveBeenCalled();
  });

  it('does not claim completed rows (claim only returns pending→processing)', async () => {
    const claimed = row({ status: 'processing' });
    const deps = makeDeps({
      claimEvents: vi.fn(async () => [claimed]),
    });

    const n = await runOutboxRelayOnce({
      ...deps,
      batchSize: 10,
      eventType: 'reservation.created',
    });

    expect(n).toBe(1);
    expect(deps.claimEvents).toHaveBeenCalledWith(10, 'reservation.created');
    expect(deps.markCompleted).toHaveBeenCalled();
  });

  it('requeues on retryable failure and updates available_at', async () => {
    const deps = makeDeps({
      getHandler: () => async () => ({
        kind: 'failed',
        permanent: false,
        reason: 'Resend timeout',
      }),
    });

    await processClaimedEvent(row({ attempts: 2 }), deps);

    expect(deps.markRequeue).toHaveBeenCalledWith(
      row().id,
      'Resend timeout',
      expect.any(String),
    );
    expect(deps.markCompleted).not.toHaveBeenCalled();
  });

  it('marks failed when max attempts exceeded', async () => {
    const deps = makeDeps({
      maxAttempts: 3,
      getHandler: () => async () => ({
        kind: 'requeue',
        reason: 'flags_not_settled',
        delayMs: 500,
      }),
    });

    await processClaimedEvent(row({ attempts: 3 }), deps);

    expect(deps.markFailed).toHaveBeenCalled();
    expect(deps.markRequeue).not.toHaveBeenCalled();
  });

  it('marks failed when no handler registered', async () => {
    const deps = makeDeps({
      getHandler: () => null,
    });

    await processClaimedEvent(row(), deps);

    expect(deps.markFailed).toHaveBeenCalledWith(
      row().id,
      expect.stringContaining('No handler'),
    );
  });
});

describe('WKR-006.1 — Relay observability', () => {
  it('increments metrics on success / failure / retry / skip', async () => {
    const metrics = createWorkerMetrics();

    await processClaimedEvent(
      row(),
      makeDeps({
        metrics,
        getHandler: () => async () => ({ kind: 'completed', reason: 'sent' }),
      }),
    );
    expect(metrics.snapshot().events_processed_total).toBe(1);

    await processClaimedEvent(
      row(),
      makeDeps({
        metrics,
        getHandler: () => async () => ({
          kind: 'completed',
          reason: 'skipped_no_email',
        }),
      }),
    );
    expect(metrics.snapshot().events_skipped_total).toBe(1);
    expect(metrics.snapshot().events_processed_total).toBe(2);

    await processClaimedEvent(
      row(),
      makeDeps({
        metrics,
        getHandler: () => async () => ({
          kind: 'completed',
          reason: 'skipped_restricted',
        }),
      }),
    );
    expect(metrics.snapshot().events_skipped_total).toBe(2);
    expect(metrics.snapshot().events_processed_total).toBe(3);

    await processClaimedEvent(
      row({ attempts: 1 }),
      makeDeps({
        metrics,
        getHandler: () => async () => ({
          kind: 'failed',
          permanent: false,
          reason: 'timeout',
        }),
      }),
    );
    expect(metrics.snapshot().events_retried_total).toBe(1);

    await processClaimedEvent(
      row(),
      makeDeps({
        metrics,
        getHandler: () => async () => ({
          kind: 'failed',
          permanent: true,
          reason: 'bad payload',
        }),
      }),
    );
    expect(metrics.snapshot().events_failed_total).toBe(1);
  });

  it('logs correlation fields without PII', async () => {
    const lines: string[] = [];
    const logger = createWorkerLogger({
      workerName: 'nomadas-outbox-relay',
      write: (line) => lines.push(line),
      now: () => new Date('2026-08-05T12:00:01.000Z'),
    });

    await processClaimedEvent(
      row(),
      makeDeps({
        logger,
        now: () => new Date('2026-08-05T12:00:01.000Z'),
      }),
    );

    const completed = lines
      .map(parseWorkerLogLine)
      .find((l) => l.event === 'outbox_completed');
    expect(completed).toMatchObject({
      event_id: row().id,
      aggregate_id: row().aggregate_id,
      agency_id: row().tenant_id,
      handler: 'reservation.created:1',
      status: 'completed',
      duration_ms: 0,
    });
    const joined = lines.join('\n');
    expect(joined).not.toMatch(/@/);
    expect(joined).not.toContain('payload');
  });

  it('calls recoverStuck before claim and logs outbox_recovery_completed', async () => {
    const lines: string[] = [];
    const logger = createWorkerLogger({
      workerName: 'nomadas-outbox-relay',
      write: (line) => lines.push(line),
    });
    const recoverStuck = vi.fn(async () => 2);
    const deps = makeDeps({
      logger,
      recoverStuck,
      claimEvents: vi.fn(async () => []),
    });

    await runOutboxRelayOnce({ ...deps, batchSize: 5, eventType: null });

    expect(recoverStuck).toHaveBeenCalledOnce();
    const recovered = lines
      .map(parseWorkerLogLine)
      .find((l) => l.event === 'outbox_recovery_completed');
    expect(recovered).toMatchObject({
      recovered_count: 2,
      recovered: 2,
      status: 'recovered',
    });
  });

  it('marks last_error_at when handler throws', async () => {
    const metrics = createWorkerMetrics(
      () => new Date('2026-08-05T12:00:00.000Z'),
    );

    await processClaimedEvent(
      row({ attempts: 1 }),
      makeDeps({
        metrics,
        getHandler: () => async () => {
          throw new Error('boom');
        },
      }),
    );

    expect(metrics.snapshot().last_error_at).toBe(
      '2026-08-05T12:00:00.000Z',
    );
    expect(metrics.snapshot().events_retried_total).toBe(1);
  });

  it('logs handler_error when handler throws then requeues', async () => {
    const lines: string[] = [];
    const logger = createWorkerLogger({
      workerName: 'nomadas-outbox-relay',
      write: (line) => lines.push(line),
    });
    const metrics = createWorkerMetrics();

    await processClaimedEvent(
      row({ attempts: 1 }),
      makeDeps({
        logger,
        metrics,
        getHandler: () => async () => {
          throw new Error('boom');
        },
      }),
    );

    const events = lines.map((l) => parseWorkerLogLine(l).event);
    expect(events).toContain('handler_error');
    expect(events).toContain('outbox_requeued');
    expect(metrics.snapshot().events_retried_total).toBe(1);
  });
});

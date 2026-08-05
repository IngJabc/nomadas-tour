import { describe, expect, it } from 'vitest';
import { createHeartbeatController } from './heartbeat.js';
import { createWorkerLogger, parseWorkerLogLine } from './logger.js';
import { createWorkerMetrics } from './metrics.js';

describe('WKR-006.1 — Worker heartbeat', () => {
  it('emits worker_heartbeat with metrics, uptime, process_id, version', () => {
    const lines: string[] = [];
    let t = new Date('2026-08-05T15:00:00.000Z').getTime();
    const startedAt = new Date('2026-08-05T14:58:00.000Z');
    const logger = createWorkerLogger({
      workerName: 'nomadas-outbox-relay',
      now: () => new Date(t),
      write: (line) => lines.push(line),
    });
    const metrics = createWorkerMetrics(() => new Date(t));
    metrics.incProcessed();

    const hb = createHeartbeatController({
      logger,
      metrics,
      intervalMs: 30_000,
      now: () => new Date(t),
      startedAt,
      processId: 4242,
      workerVersion: '1.0.0',
    });

    expect(hb.maybeEmit(true)).toBe(true);
    expect(hb.isAlive(60_000)).toBe(true);

    const parsed = parseWorkerLogLine(lines[0]!);
    expect(parsed.event).toBe('worker_heartbeat');
    expect(parsed.status).toBe('alive');
    expect(parsed.uptime_seconds).toBe(120);
    expect(parsed.process_id).toBe(4242);
    expect(parsed.worker_version).toBe('1.0.0');
    expect(parsed.metrics).toMatchObject({
      events_processed_total: 1,
      events_failed_total: 0,
      last_success_at: '2026-08-05T15:00:00.000Z',
    });

    t += 1_000;
    expect(hb.maybeEmit(false)).toBe(false);
    expect(lines).toHaveLength(1);

    t += 30_000;
    expect(hb.maybeEmit(false)).toBe(true);
    expect(lines).toHaveLength(2);
  });

  it('isAlive becomes false when heartbeat is stale', () => {
    let t = new Date('2026-08-05T15:00:00.000Z').getTime();
    const logger = createWorkerLogger({
      workerName: 'nomadas-outbox-relay',
      write: () => undefined,
      now: () => new Date(t),
    });
    const hb = createHeartbeatController({
      logger,
      metrics: createWorkerMetrics(),
      intervalMs: 30_000,
      now: () => new Date(t),
    });
    hb.touch();
    expect(hb.isAlive(5_000, new Date(t))).toBe(true);
    expect(hb.isAlive(5_000, new Date(t + 6_000))).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  env: {
    OCCUPANCY_ALERT_VIA_WORKER: false,
    OCCUPANCY_ALERT_POLL_MS: 3_600_000,
    OCCUPANCY_ALERT_BATCH: 50,
  },
}));

vi.mock('../config/database.js', () => ({
  supabaseAdmin: { rpc: vi.fn() },
}));

import {
  runOccupancyAlertCycle,
  startOccupancyAlertScheduler,
  type OccupancyAlertCursor,
  type OccupancyAlertEvaluateResult,
  type OccupancyAlertSchedulerDeps,
} from './occupancy-alert-scheduler.js';
import type { WorkerLogger } from './observability/logger.js';

function makeLogger(): WorkerLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(function (this: WorkerLogger) {
      return this;
    }),
  };
}

function page(
  scanned: number,
  hasMore: boolean,
  cursor: OccupancyAlertCursor | null,
  extras: Partial<OccupancyAlertEvaluateResult> = {},
): OccupancyAlertEvaluateResult {
  return {
    scanned,
    evaluated: scanned,
    emitted: 0,
    skipped: 0,
    skipped_invalid_occupancy: 0,
    cleaned_up: 0,
    batch: 50,
    has_more: hasMore,
    next_cursor: cursor,
    ...extras,
  };
}

describe('F4-003 — occupancy alert scheduler loop', () => {
  it('skips RPC when flag disabled and logs skipped_effect_disabled', async () => {
    const logger = makeLogger();
    const evaluate = vi.fn();
    const controller = new AbortController();

    const deps: OccupancyAlertSchedulerDeps = {
      isEnabled: () => false,
      pollMs: 10,
      batch: 50,
      evaluate,
      logger,
    };

    const handle = startOccupancyAlertScheduler(controller.signal, deps);
    await new Promise((r) => setTimeout(r, 25));
    controller.abort();
    await handle.done;

    expect(evaluate).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'occupancy_alert_scheduler_started',
      expect.objectContaining({ occupancy_alert_via_worker: false }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'occupancy_alert_scheduler_tick',
      expect.objectContaining({ status: 'skipped_effect_disabled' }),
    );
  });

  it('evaluates when enabled and logs tick metrics', async () => {
    const logger = makeLogger();
    const evaluate = vi.fn(async () =>
      page(3, false, null, { emitted: 1, skipped: 2 }),
    );
    const controller = new AbortController();

    const handle = startOccupancyAlertScheduler(controller.signal, {
      isEnabled: () => true,
      pollMs: 10,
      batch: 50,
      evaluate,
      logger,
    });

    await new Promise((r) => setTimeout(r, 25));
    controller.abort();
    await handle.done;

    expect(evaluate).toHaveBeenCalledWith(50, null);
    expect(logger.info).toHaveBeenCalledWith(
      'occupancy_alert_scheduler_tick',
      expect.objectContaining({
        status: 'ok',
        scanned: 3,
        emitted: 1,
        skipped: 2,
      }),
    );
  });

  it('logs errors without rejecting the loop', async () => {
    const logger = makeLogger();
    let calls = 0;
    const evaluate = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('rpc failed');
      return page(0, false, null);
    });
    const controller = new AbortController();

    const handle = startOccupancyAlertScheduler(controller.signal, {
      isEnabled: () => true,
      pollMs: 10,
      batch: 50,
      evaluate,
      logger,
    });

    await new Promise((r) => setTimeout(r, 45));
    controller.abort();
    await handle.done;

    expect(logger.error).toHaveBeenCalledWith(
      'occupancy_alert_scheduler_error',
      expect.objectContaining({
        status: 'error',
        error: 'rpc failed',
      }),
    );
    expect(evaluate.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('F4-003 — batch fairness / keyset cycle', () => {
  it('processes 50 trips in one invocation', async () => {
    const evaluate = vi.fn(async () => page(50, false, null));
    const result = await runOccupancyAlertCycle(50, evaluate);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(result.scanned).toBe(50);
  });

  it('processes 51 trips in two invocations without restarting the keyset', async () => {
    const firstCursor = { departure_time: '2026-08-20T10:00:00.000Z', id: 't50' };
    const evaluate = vi.fn(async (_batch, cursor) => {
      if (!cursor) return page(50, true, firstCursor);
      expect(cursor).toEqual(firstCursor);
      return page(1, false, { departure_time: '2026-08-20T11:00:00.000Z', id: 't51' });
    });

    const result = await runOccupancyAlertCycle(50, evaluate);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(result.scanned).toBe(51);
  });

  it('processes 100 trips in two full pages', async () => {
    const evaluate = vi.fn(async (_batch, cursor) => {
      if (!cursor) {
        return page(50, true, { departure_time: 'a', id: '50' });
      }
      return page(50, false, { departure_time: 'b', id: '100' });
    });
    const result = await runOccupancyAlertCycle(50, evaluate);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(result.scanned).toBe(100);
  });

  it('processes 300 trips in six pages and keeps progressing', async () => {
    let pageIndex = 0;
    const evaluate = vi.fn(async (_batch, cursor) => {
      if (pageIndex > 0) {
        expect(cursor?.id).toBe(String(pageIndex * 50));
      }
      pageIndex += 1;
      const lastId = String(pageIndex * 50);
      return page(50, pageIndex < 6, { departure_time: `d${pageIndex}`, id: lastId });
    });

    const result = await runOccupancyAlertCycle(50, evaluate);
    expect(evaluate).toHaveBeenCalledTimes(6);
    expect(result.scanned).toBe(300);
  });

  it('restarts from the beginning on a new cycle (worker restart safe)', async () => {
    const evaluate = vi.fn(async (_batch, cursor) => {
      expect(cursor).toBeNull();
      return page(10, false, null, { emitted: 0 });
    });
    await runOccupancyAlertCycle(50, evaluate);
    await runOccupancyAlertCycle(50, evaluate);
    expect(evaluate).toHaveBeenNthCalledWith(1, 50, null);
    expect(evaluate).toHaveBeenNthCalledWith(2, 50, null);
  });
});

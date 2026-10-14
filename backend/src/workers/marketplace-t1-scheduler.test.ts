import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  env: {
    MARKETPLACE_T1_CANCEL_VIA_WORKER: false,
    MARKETPLACE_T1_CANCEL_POLL_MS: 900_000,
    MARKETPLACE_T1_CANCEL_BATCH: 50,
  },
}));

vi.mock('../config/database.js', () => ({
  supabaseAdmin: { rpc: vi.fn() },
}));

import {
  startMarketplaceT1Scheduler,
  type MarketplaceT1SchedulerDeps,
} from './marketplace-t1-scheduler.js';
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

describe('MKT-008 — marketplace T-1 scheduler loop', () => {
  it('skips RPC when flag disabled and logs skipped_disabled', async () => {
    const logger = makeLogger();
    const schedule = vi.fn(async () => ({ scanned: 0, cancelled: 0, batch: 50 }));
    const controller = new AbortController();

    const deps: MarketplaceT1SchedulerDeps = {
      isEnabled: () => false,
      pollMs: 10,
      batch: 50,
      schedule,
      logger,
    };

    const handle = startMarketplaceT1Scheduler(controller.signal, deps);
    await new Promise((r) => setTimeout(r, 25));
    controller.abort();
    await handle.done;

    expect(schedule).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'marketplace_t1_scheduler_started',
      expect.objectContaining({ marketplace_t1_cancel_via_worker: false }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'mkt008_tick',
      expect.objectContaining({ status: 'skipped_disabled' }),
    );
  });

  it('calls schedule when enabled and logs scanned/cancelled', async () => {
    const logger = makeLogger();
    const schedule = vi.fn(async () => ({ scanned: 5, cancelled: 3, batch: 50 }));
    const controller = new AbortController();

    const handle = startMarketplaceT1Scheduler(controller.signal, {
      isEnabled: () => true,
      pollMs: 10,
      batch: 50,
      schedule,
      logger,
    });

    await new Promise((r) => setTimeout(r, 25));
    controller.abort();
    await handle.done;

    expect(schedule).toHaveBeenCalledWith(50);
    expect(logger.info).toHaveBeenCalledWith(
      'mkt008_tick',
      expect.objectContaining({
        status: 'ok',
        scanned: 5,
        cancelled: 3,
      }),
    );
  });

  it('logs errors without rejecting the loop', async () => {
    const logger = makeLogger();
    let calls = 0;
    const schedule = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('rpc failed');
      return { scanned: 0, cancelled: 0, batch: 50 };
    });
    const controller = new AbortController();

    const handle = startMarketplaceT1Scheduler(controller.signal, {
      isEnabled: () => true,
      pollMs: 10,
      batch: 50,
      schedule,
      logger,
    });

    await new Promise((r) => setTimeout(r, 45));
    controller.abort();
    await handle.done;

    expect(logger.error).toHaveBeenCalledWith(
      'mkt008_tick_error',
      expect.objectContaining({
        status: 'error',
        error: 'rpc failed',
      }),
    );
    expect(schedule.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('stops cleanly on abort signal', async () => {
    const logger = makeLogger();
    const schedule = vi.fn(async () => ({ scanned: 0, cancelled: 0, batch: 50 }));
    const controller = new AbortController();

    const handle = startMarketplaceT1Scheduler(controller.signal, {
      isEnabled: () => true,
      pollMs: 1000,
      batch: 50,
      schedule,
      logger,
    });

    // Abort before first sleep completes
    controller.abort();
    await handle.done;

    expect(logger.info).toHaveBeenCalledWith(
      'marketplace_t1_scheduler_stopped',
      expect.objectContaining({ status: 'stopped' }),
    );
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  env: {
    OUTBOX_RETENTION_VIA_WORKER: false,
    OUTBOX_RETENTION_POLL_MS: 86_400_000,
    OUTBOX_RETENTION_BATCH: 1000,
    OUTBOX_RETENTION_DAYS: 30,
  },
}));

vi.mock('../config/database.js', () => ({
  supabaseAdmin: { rpc: vi.fn() },
}));

import {
  startRetentionScheduler,
  type RetentionSchedulerDeps,
} from './retention-scheduler.js';
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

describe('WKR-009 — retention scheduler loop', () => {
  it('skips RPC when flag disabled and logs skipped_effect_disabled', async () => {
    const logger = makeLogger();
    const purge = vi.fn(async () => ({
      deleted: 0,
      batch: 1000,
      older_than_days: 30,
      cutoff: null,
    }));
    const controller = new AbortController();

    const deps: RetentionSchedulerDeps = {
      isEnabled: () => false,
      pollMs: 10,
      batch: 1000,
      olderThanDays: 30,
      purge,
      logger,
    };

    const handle = startRetentionScheduler(controller.signal, deps);
    await new Promise((r) => setTimeout(r, 25));
    controller.abort();
    await handle.done;

    expect(purge).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'retention_scheduler_started',
      expect.objectContaining({ outbox_retention_via_worker: false }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'retention_scheduler_tick',
      expect.objectContaining({ status: 'skipped_effect_disabled' }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'retention_scheduler_stopped',
      expect.objectContaining({ status: 'stopped' }),
    );
  });

  it('calls purge when enabled with batch and olderThanDays', async () => {
    const logger = makeLogger();
    const purge = vi.fn(async () => ({
      deleted: 7,
      batch: 1000,
      older_than_days: 30,
      cutoff: '2026-07-13T00:00:00.000Z',
    }));
    const controller = new AbortController();

    const handle = startRetentionScheduler(controller.signal, {
      isEnabled: () => true,
      pollMs: 10,
      batch: 1000,
      olderThanDays: 30,
      purge,
      logger,
    });

    await new Promise((r) => setTimeout(r, 25));
    controller.abort();
    await handle.done;

    expect(purge).toHaveBeenCalledWith(1000, 30);
    expect(logger.info).toHaveBeenCalledWith(
      'retention_scheduler_tick',
      expect.objectContaining({
        status: 'ok',
        deleted: 7,
        batch: 1000,
        cutoff: '2026-07-13T00:00:00.000Z',
      }),
    );
  });

  it('logs errors without rejecting the loop', async () => {
    const logger = makeLogger();
    let calls = 0;
    const purge = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('rpc failed');
      return {
        deleted: 0,
        batch: 1000,
        older_than_days: 30,
        cutoff: null,
      };
    });
    const controller = new AbortController();

    const handle = startRetentionScheduler(controller.signal, {
      isEnabled: () => true,
      pollMs: 10,
      batch: 1000,
      olderThanDays: 30,
      purge,
      logger,
    });

    await new Promise((r) => setTimeout(r, 45));
    controller.abort();
    await handle.done;

    expect(logger.error).toHaveBeenCalledWith(
      'retention_scheduler_error',
      expect.objectContaining({
        status: 'error',
        error: 'rpc failed',
      }),
    );
    expect(purge.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('aborts cleanly and resolves done', async () => {
    const logger = makeLogger();
    const purge = vi.fn(async () => ({
      deleted: 0,
      batch: 1000,
      older_than_days: 30,
      cutoff: null,
    }));
    const controller = new AbortController();

    const handle = startRetentionScheduler(controller.signal, {
      isEnabled: () => true,
      pollMs: 60_000,
      batch: 1000,
      olderThanDays: 30,
      purge,
      logger,
    });

    // Let the first tick + long sleep start, then abort.
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    await expect(handle.done).resolves.toBeUndefined();

    expect(logger.info).toHaveBeenCalledWith(
      'retention_scheduler_stopped',
      expect.objectContaining({ status: 'stopped' }),
    );
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  env: {
    AGENCY_DIGEST_VIA_WORKER: false,
    AGENCY_DIGEST_POLL_MS: 3_600_000,
    AGENCY_DIGEST_BATCH: 50,
  },
}));

vi.mock('../config/database.js', () => ({
  supabaseAdmin: { rpc: vi.fn() },
}));

import {
  AGENCY_DIGEST_LOCAL_HOUR,
  startDigestScheduler,
  type DigestSchedulerDeps,
} from './digest-scheduler.js';
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

describe('F4-001 — digest scheduler loop', () => {
  it('skips RPC when flag disabled and logs skipped_effect_disabled', async () => {
    const logger = makeLogger();
    const schedule = vi.fn(async () => ({
      scanned: 0,
      emitted: 0,
      batch: 50,
      digest_date: '2026-08-12',
    }));
    const controller = new AbortController();

    const deps: DigestSchedulerDeps = {
      isEnabled: () => false,
      pollMs: 10,
      batch: 50,
      localHour: AGENCY_DIGEST_LOCAL_HOUR,
      getLocalHour: () => 7,
      getDigestDate: () => '2026-08-12',
      schedule,
      logger,
    };

    const handle = startDigestScheduler(controller.signal, deps);
    await new Promise((r) => setTimeout(r, 25));
    controller.abort();
    await handle.done;

    expect(schedule).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'digest_scheduler_started',
      expect.objectContaining({ agency_digest_via_worker: false }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'digest_scheduler_tick',
      expect.objectContaining({ status: 'skipped_effect_disabled' }),
    );
  });

  it('skips RPC outside 07:00 window and logs skipped_outside_window', async () => {
    const logger = makeLogger();
    const schedule = vi.fn(async () => ({
      scanned: 0,
      emitted: 0,
      batch: 50,
      digest_date: '2026-08-12',
    }));
    const controller = new AbortController();

    const handle = startDigestScheduler(controller.signal, {
      isEnabled: () => true,
      pollMs: 10,
      batch: 50,
      localHour: AGENCY_DIGEST_LOCAL_HOUR,
      getLocalHour: () => 15,
      getDigestDate: () => '2026-08-12',
      schedule,
      logger,
    });

    await new Promise((r) => setTimeout(r, 25));
    controller.abort();
    await handle.done;

    expect(schedule).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'digest_scheduler_tick',
      expect.objectContaining({
        status: 'skipped_outside_window',
        local_hour: 15,
        expected_hour: 7,
      }),
    );
  });

  it('calls schedule when enabled at local hour 7', async () => {
    const logger = makeLogger();
    const schedule = vi.fn(async () => ({
      scanned: 4,
      emitted: 3,
      batch: 50,
      digest_date: '2026-08-12',
    }));
    const controller = new AbortController();

    const handle = startDigestScheduler(controller.signal, {
      isEnabled: () => true,
      pollMs: 10,
      batch: 50,
      localHour: AGENCY_DIGEST_LOCAL_HOUR,
      getLocalHour: () => 7,
      getDigestDate: () => '2026-08-12',
      schedule,
      logger,
    });

    await new Promise((r) => setTimeout(r, 25));
    controller.abort();
    await handle.done;

    expect(schedule).toHaveBeenCalledWith(50, '2026-08-12');
    expect(logger.info).toHaveBeenCalledWith(
      'digest_scheduler_tick',
      expect.objectContaining({
        status: 'ok',
        scanned: 4,
        emitted: 3,
        digest_date: '2026-08-12',
      }),
    );
  });

  it('logs errors without rejecting the loop', async () => {
    const logger = makeLogger();
    let calls = 0;
    const schedule = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('rpc failed');
      return {
        scanned: 0,
        emitted: 0,
        batch: 50,
        digest_date: '2026-08-12',
      };
    });
    const controller = new AbortController();

    const handle = startDigestScheduler(controller.signal, {
      isEnabled: () => true,
      pollMs: 10,
      batch: 50,
      localHour: AGENCY_DIGEST_LOCAL_HOUR,
      getLocalHour: () => 7,
      getDigestDate: () => '2026-08-12',
      schedule,
      logger,
    });

    await new Promise((r) => setTimeout(r, 45));
    controller.abort();
    await handle.done;

    expect(logger.error).toHaveBeenCalledWith(
      'digest_scheduler_error',
      expect.objectContaining({
        status: 'error',
        error: 'rpc failed',
      }),
    );
    expect(schedule.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

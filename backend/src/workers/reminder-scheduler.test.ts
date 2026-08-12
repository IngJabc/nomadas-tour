import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  env: {
    TRIP_REMINDER_VIA_OUTBOX: false,
    REMINDER_SCHEDULE_POLL_MS: 3_600_000,
    REMINDER_SCHEDULE_BATCH: 50,
  },
}));

vi.mock('../config/database.js', () => ({
  supabaseAdmin: { rpc: vi.fn() },
}));

import {
  startReminderScheduler,
  type ReminderSchedulerDeps,
} from './reminder-scheduler.js';
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

describe('WKR-008 — reminder scheduler loop', () => {
  it('skips RPC when flag disabled and logs skipped_effect_disabled', async () => {
    const logger = makeLogger();
    const schedule = vi.fn(async () => ({ scanned: 0, emitted: 0, batch: 50 }));
    const controller = new AbortController();

    const deps: ReminderSchedulerDeps = {
      isEnabled: () => false,
      pollMs: 10,
      batch: 50,
      schedule,
      logger,
    };

    const handle = startReminderScheduler(controller.signal, deps);
    await new Promise((r) => setTimeout(r, 25));
    controller.abort();
    await handle.done;

    expect(schedule).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'reminder_scheduler_started',
      expect.objectContaining({ trip_reminder_via_outbox: false }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'reminder_scheduler_tick',
      expect.objectContaining({ status: 'skipped_effect_disabled' }),
    );
  });

  it('calls schedule when enabled and logs scanned/emitted', async () => {
    const logger = makeLogger();
    const schedule = vi.fn(async () => ({ scanned: 3, emitted: 2, batch: 50 }));
    const controller = new AbortController();

    const handle = startReminderScheduler(controller.signal, {
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
      'reminder_scheduler_tick',
      expect.objectContaining({
        status: 'ok',
        scanned: 3,
        emitted: 2,
      }),
    );
  });

  it('logs errors without rejecting the loop', async () => {
    const logger = makeLogger();
    let calls = 0;
    const schedule = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('rpc failed');
      return { scanned: 0, emitted: 0, batch: 50 };
    });
    const controller = new AbortController();

    const handle = startReminderScheduler(controller.signal, {
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
      'reminder_scheduler_error',
      expect.objectContaining({
        status: 'error',
        error: 'rpc failed',
      }),
    );
    expect(schedule.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

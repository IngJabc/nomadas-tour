import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  env: {
    SUPERADMIN_DIGEST_VIA_WORKER: false,
    SUPERADMIN_DIGEST_POLL_MS: 3_600_000,
    SUPERADMIN_DIGEST_BATCH: 50,
  },
}));

vi.mock('../config/database.js', () => ({
  supabaseAdmin: { rpc: vi.fn() },
}));

import { platformDigestAggregateId } from '../utils/deterministic-uuid.js';
import {
  SUPERADMIN_DIGEST_LOCAL_HOUR,
  startSuperadminDigestScheduler,
  type SuperadminDigestSchedulerDeps,
} from './superadmin-digest-scheduler.js';
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

describe('F4-002 — superadmin digest scheduler loop', () => {
  it('skips emit when flag disabled and logs skipped_effect_disabled', async () => {
    const logger = makeLogger();
    const emitDueEvent = vi.fn(async () => ({
      emitted: 0,
      digest_date: '2026-08-13',
      aggregate_id: platformDigestAggregateId('2026-08-13'),
      dedup_key: 'superadmin.digest.due:2026-08-13',
    }));
    const controller = new AbortController();

    const deps: SuperadminDigestSchedulerDeps = {
      isEnabled: () => false,
      pollMs: 10,
      batch: 50,
      localHour: SUPERADMIN_DIGEST_LOCAL_HOUR,
      getLocalHour: () => 7,
      getDigestDate: () => '2026-08-13',
      emitDueEvent,
      logger,
    };

    const handle = startSuperadminDigestScheduler(controller.signal, deps);
    await new Promise((r) => setTimeout(r, 25));
    controller.abort();
    await handle.done;

    expect(emitDueEvent).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'superadmin_digest_scheduler_started',
      expect.objectContaining({ superadmin_digest_via_worker: false }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'superadmin_digest_scheduler_tick',
      expect.objectContaining({ status: 'skipped_effect_disabled' }),
    );
  });

  it('skips emit outside 07:00 window and logs skipped_outside_window', async () => {
    const logger = makeLogger();
    const emitDueEvent = vi.fn(async () => ({
      emitted: 0,
      digest_date: '2026-08-13',
      aggregate_id: platformDigestAggregateId('2026-08-13'),
      dedup_key: 'superadmin.digest.due:2026-08-13',
    }));
    const controller = new AbortController();

    const handle = startSuperadminDigestScheduler(controller.signal, {
      isEnabled: () => true,
      pollMs: 10,
      batch: 50,
      localHour: SUPERADMIN_DIGEST_LOCAL_HOUR,
      getLocalHour: () => 15,
      getDigestDate: () => '2026-08-13',
      emitDueEvent,
      logger,
    });

    await new Promise((r) => setTimeout(r, 25));
    controller.abort();
    await handle.done;

    expect(emitDueEvent).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'superadmin_digest_scheduler_tick',
      expect.objectContaining({
        status: 'skipped_outside_window',
        local_hour: 15,
        expected_hour: 7,
      }),
    );
  });

  it('emits during 07 Caracas window with digest_date and dedup', async () => {
    const logger = makeLogger();
    const emitDueEvent = vi.fn(async (digestDate: string) => ({
      emitted: 1,
      digest_date: digestDate,
      aggregate_id: platformDigestAggregateId(digestDate),
      dedup_key: `superadmin.digest.due:${digestDate}`,
    }));
    const controller = new AbortController();

    const handle = startSuperadminDigestScheduler(controller.signal, {
      isEnabled: () => true,
      pollMs: 10,
      batch: 50,
      localHour: SUPERADMIN_DIGEST_LOCAL_HOUR,
      getLocalHour: () => 7,
      getDigestDate: () => '2026-08-13',
      emitDueEvent,
      logger,
    });

    await new Promise((r) => setTimeout(r, 25));
    controller.abort();
    await handle.done;

    expect(emitDueEvent).toHaveBeenCalledWith('2026-08-13');
    expect(logger.info).toHaveBeenCalledWith(
      'superadmin_digest_scheduler_tick',
      expect.objectContaining({
        status: 'ok',
        emitted: 1,
        digest_date: '2026-08-13',
        dedup_key: 'superadmin.digest.due:2026-08-13',
        aggregate_id: platformDigestAggregateId('2026-08-13'),
      }),
    );
  });

  it('logs errors without rejecting the loop', async () => {
    const logger = makeLogger();
    let calls = 0;
    const emitDueEvent = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('rpc failed');
      return {
        emitted: 0,
        digest_date: '2026-08-13',
        aggregate_id: platformDigestAggregateId('2026-08-13'),
        dedup_key: 'superadmin.digest.due:2026-08-13',
      };
    });
    const controller = new AbortController();

    const handle = startSuperadminDigestScheduler(controller.signal, {
      isEnabled: () => true,
      pollMs: 10,
      batch: 50,
      localHour: SUPERADMIN_DIGEST_LOCAL_HOUR,
      getLocalHour: () => 7,
      getDigestDate: () => '2026-08-13',
      emitDueEvent,
      logger,
    });

    await new Promise((r) => setTimeout(r, 45));
    controller.abort();
    await handle.done;

    expect(logger.error).toHaveBeenCalledWith(
      'superadmin_digest_scheduler_error',
      expect.objectContaining({
        status: 'error',
        error: 'rpc failed',
      }),
    );
    expect(emitDueEvent.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

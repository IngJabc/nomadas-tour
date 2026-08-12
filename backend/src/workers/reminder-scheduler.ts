import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/database.js';
import type { WorkerLogger } from './observability/logger.js';

export interface ReminderScheduleResult {
  scanned: number;
  emitted: number;
  batch: number;
}

export interface ReminderSchedulerDeps {
  isEnabled: () => boolean;
  pollMs: number;
  batch: number;
  schedule: (batch: number) => Promise<ReminderScheduleResult>;
  logger: WorkerLogger;
  now?: () => number;
}

export interface ReminderSchedulerHandle {
  /** Resolves when the loop exits (abort or stop). */
  done: Promise<void>;
}

function parseScheduleResult(data: unknown): ReminderScheduleResult {
  const row =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  return {
    scanned: typeof row.scanned === 'number' ? row.scanned : 0,
    emitted: typeof row.emitted === 'number' ? row.emitted : 0,
    batch: typeof row.batch === 'number' ? row.batch : 0,
  };
}

export async function callScheduleTripReminders(
  batch: number,
): Promise<ReminderScheduleResult> {
  const { data, error } = await supabaseAdmin.rpc('schedule_trip_reminders', {
    p_batch: batch,
  });
  if (error) {
    throw new Error(`schedule_trip_reminders: ${error.message}`);
  }
  return parseScheduleResult(data);
}

export function createDefaultReminderSchedulerDeps(
  logger: WorkerLogger,
): ReminderSchedulerDeps {
  return {
    isEnabled: () => env.TRIP_REMINDER_VIA_OUTBOX,
    pollMs: env.REMINDER_SCHEDULE_POLL_MS,
    batch: env.REMINDER_SCHEDULE_BATCH,
    schedule: callScheduleTripReminders,
    logger,
  };
}

/**
 * WKR-008 — durable reminder poll loop inside the existing Node worker.
 * Runs until AbortSignal fires. Errors are logged and do not throw out of the loop.
 */
export function startReminderScheduler(
  signal: AbortSignal,
  deps: ReminderSchedulerDeps,
): ReminderSchedulerHandle {
  const nowFn = deps.now ?? (() => Date.now());

  const done = (async () => {
    deps.logger.info('reminder_scheduler_started', {
      status: 'started',
      poll_ms: deps.pollMs,
      batch: deps.batch,
      trip_reminder_via_outbox: deps.isEnabled(),
    });

    while (!signal.aborted) {
      const tickStarted = nowFn();
      try {
        if (!deps.isEnabled()) {
          deps.logger.info('reminder_scheduler_tick', {
            status: 'skipped_effect_disabled',
            duration_ms: nowFn() - tickStarted,
          });
        } else {
          const result = await deps.schedule(deps.batch);
          deps.logger.info('reminder_scheduler_tick', {
            status: 'ok',
            scanned: result.scanned,
            emitted: result.emitted,
            batch: result.batch,
            duration_ms: nowFn() - tickStarted,
          });
        }
      } catch (err) {
        deps.logger.error('reminder_scheduler_error', {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          duration_ms: nowFn() - tickStarted,
        });
      }

      await sleep(deps.pollMs, signal);
    }

    deps.logger.info('reminder_scheduler_stopped', { status: 'stopped' });
  })();

  // Prevent an unhandled rejection if the consumer never awaits `done`.
  void done.catch(() => undefined);

  return { done };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    timer.unref?.();

    function onAbort() {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

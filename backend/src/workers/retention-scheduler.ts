import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/database.js';
import type { WorkerLogger } from './observability/logger.js';

export interface RetentionPurgeResult {
  deleted: number;
  batch: number;
  older_than_days: number;
  cutoff: string | null;
}

export interface RetentionSchedulerDeps {
  isEnabled: () => boolean;
  pollMs: number;
  batch: number;
  olderThanDays: number;
  purge: (
    batch: number,
    olderThanDays: number,
  ) => Promise<RetentionPurgeResult>;
  logger: WorkerLogger;
  now?: () => number;
}

export interface RetentionSchedulerHandle {
  /** Resolves when the loop exits (abort or stop). */
  done: Promise<void>;
}

function parsePurgeResult(data: unknown): RetentionPurgeResult {
  const row =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  return {
    deleted: typeof row.deleted === 'number' ? row.deleted : Number(row.deleted) || 0,
    batch: typeof row.batch === 'number' ? row.batch : Number(row.batch) || 0,
    older_than_days:
      typeof row.older_than_days === 'number'
        ? row.older_than_days
        : Number(row.older_than_days) || 0,
    cutoff:
      typeof row.cutoff === 'string'
        ? row.cutoff
        : row.cutoff != null
          ? String(row.cutoff)
          : null,
  };
}

export async function callPurgeCompletedOutboxEvents(
  batch: number,
  olderThanDays: number,
): Promise<RetentionPurgeResult> {
  const { data, error } = await supabaseAdmin.rpc(
    'purge_completed_outbox_events',
    {
      p_batch: batch,
      p_older_than_days: olderThanDays,
    },
  );
  if (error) {
    throw new Error(`purge_completed_outbox_events: ${error.message}`);
  }
  return parsePurgeResult(data);
}

export function createDefaultRetentionSchedulerDeps(
  logger: WorkerLogger,
): RetentionSchedulerDeps {
  return {
    isEnabled: () => env.OUTBOX_RETENTION_VIA_WORKER,
    pollMs: env.OUTBOX_RETENTION_POLL_MS,
    batch: env.OUTBOX_RETENTION_BATCH,
    olderThanDays: env.OUTBOX_RETENTION_DAYS,
    purge: callPurgeCompletedOutboxEvents,
    logger,
  };
}

/**
 * WKR-009 — durable outbox retention poll loop inside the existing Node worker.
 * Runs until AbortSignal fires. Errors are logged and do not throw out of the loop.
 */
export function startRetentionScheduler(
  signal: AbortSignal,
  deps: RetentionSchedulerDeps,
): RetentionSchedulerHandle {
  const nowFn = deps.now ?? (() => Date.now());

  const done = (async () => {
    deps.logger.info('retention_scheduler_started', {
      status: 'started',
      poll_ms: deps.pollMs,
      batch: deps.batch,
      older_than_days: deps.olderThanDays,
      outbox_retention_via_worker: deps.isEnabled(),
    });

    while (!signal.aborted) {
      const tickStarted = nowFn();
      try {
        if (!deps.isEnabled()) {
          deps.logger.info('retention_scheduler_tick', {
            status: 'skipped_effect_disabled',
            duration_ms: nowFn() - tickStarted,
          });
        } else {
          const result = await deps.purge(deps.batch, deps.olderThanDays);
          deps.logger.info('retention_scheduler_tick', {
            status: 'ok',
            deleted: result.deleted,
            batch: result.batch,
            older_than_days: result.older_than_days,
            cutoff: result.cutoff,
            duration_ms: nowFn() - tickStarted,
          });
        }
      } catch (err) {
        deps.logger.error('retention_scheduler_error', {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          duration_ms: nowFn() - tickStarted,
        });
      }

      await sleep(deps.pollMs, signal);
    }

    deps.logger.info('retention_scheduler_stopped', { status: 'stopped' });
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

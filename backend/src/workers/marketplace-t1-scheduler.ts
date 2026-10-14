import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/database.js';
import type { WorkerLogger } from './observability/logger.js';

export interface MarketplaceT1Result {
  scanned: number;
  cancelled: number;
  batch: number;
}

export interface MarketplaceT1SchedulerDeps {
  isEnabled: () => boolean;
  pollMs: number;
  batch: number;
  schedule: (batch: number) => Promise<MarketplaceT1Result>;
  logger: WorkerLogger;
  now?: () => number;
}

export interface MarketplaceT1SchedulerHandle {
  /** Resolves when the loop exits (abort or stop). */
  done: Promise<void>;
}

function parseT1Result(data: unknown): MarketplaceT1Result {
  const row =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  return {
    scanned: typeof row.scanned === 'number' ? row.scanned : 0,
    cancelled: typeof row.cancelled === 'number' ? row.cancelled : 0,
    batch: typeof row.batch === 'number' ? row.batch : 0,
  };
}

export async function callScheduleMarketplaceT1Cancellations(
  batch: number,
): Promise<MarketplaceT1Result> {
  const { data, error } = await supabaseAdmin.rpc(
    'schedule_marketplace_t1_cancellations',
    { p_batch: batch },
  );
  if (error) {
    throw new Error(`schedule_marketplace_t1_cancellations: ${error.message}`);
  }
  return parseT1Result(data);
}

export function createDefaultMarketplaceT1SchedulerDeps(
  logger: WorkerLogger,
): MarketplaceT1SchedulerDeps {
  return {
    isEnabled: () => env.MARKETPLACE_T1_CANCEL_VIA_WORKER,
    pollMs: env.MARKETPLACE_T1_CANCEL_POLL_MS,
    batch: env.MARKETPLACE_T1_CANCEL_BATCH,
    schedule: callScheduleMarketplaceT1Cancellations,
    logger,
  };
}

/**
 * MKT-008 — durable T-1 cancellation poll loop inside the existing Node worker.
 * Runs until AbortSignal fires. Errors are logged and do not throw out of the loop.
 */
export function startMarketplaceT1Scheduler(
  signal: AbortSignal,
  deps: MarketplaceT1SchedulerDeps,
): MarketplaceT1SchedulerHandle {
  const nowFn = deps.now ?? (() => Date.now());

  const done = (async () => {
    deps.logger.info('marketplace_t1_scheduler_started', {
      status: 'started',
      poll_ms: deps.pollMs,
      batch: deps.batch,
      marketplace_t1_cancel_via_worker: deps.isEnabled(),
    });

    while (!signal.aborted) {
      const tickStarted = nowFn();
      try {
        if (!deps.isEnabled()) {
          deps.logger.info('mkt008_tick', {
            status: 'skipped_disabled',
            duration_ms: nowFn() - tickStarted,
          });
        } else {
          const result = await deps.schedule(deps.batch);
          deps.logger.info('mkt008_tick', {
            status: 'ok',
            scanned: result.scanned,
            cancelled: result.cancelled,
            batch: result.batch,
            last_tick_ms: nowFn(),
            duration_ms: nowFn() - tickStarted,
          });
        }
      } catch (err) {
        deps.logger.error('mkt008_tick_error', {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          duration_ms: nowFn() - tickStarted,
        });
      }

      await sleep(deps.pollMs, signal);
    }

    deps.logger.info('marketplace_t1_scheduler_stopped', { status: 'stopped' });
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

import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/database.js';
import {
  getBusinessHour,
  toBusinessDateString,
} from '../utils/timezone.js';
import type { WorkerLogger } from './observability/logger.js';

/** D1 — send when local hour in America/Caracas is 07. */
export const AGENCY_DIGEST_LOCAL_HOUR = 7;

export interface DigestScheduleResult {
  scanned: number;
  emitted: number;
  batch: number;
  digest_date: string;
}

export interface DigestSchedulerDeps {
  isEnabled: () => boolean;
  pollMs: number;
  batch: number;
  /** Local hour (0–23) in BUSINESS_TIMEZONE that opens the send window. */
  localHour: number;
  getLocalHour: (now: Date) => number;
  getDigestDate: (now: Date) => string;
  schedule: (
    batch: number,
    digestDate: string,
  ) => Promise<DigestScheduleResult>;
  logger: WorkerLogger;
  now?: () => number;
}

export interface DigestSchedulerHandle {
  /** Resolves when the loop exits (abort or stop). */
  done: Promise<void>;
}

function parseScheduleResult(
  data: unknown,
  fallbackDigestDate: string,
): DigestScheduleResult {
  const row =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  return {
    scanned: typeof row.scanned === 'number' ? row.scanned : Number(row.scanned) || 0,
    emitted: typeof row.emitted === 'number' ? row.emitted : Number(row.emitted) || 0,
    batch: typeof row.batch === 'number' ? row.batch : Number(row.batch) || 0,
    digest_date:
      typeof row.digest_date === 'string' && row.digest_date
        ? row.digest_date
        : fallbackDigestDate,
  };
}

export async function callScheduleAgencyDigests(
  batch: number,
  digestDate: string,
): Promise<DigestScheduleResult> {
  const { data, error } = await supabaseAdmin.rpc('schedule_agency_digests', {
    p_batch: batch,
    p_digest_date: digestDate,
  });
  if (error) {
    throw new Error(`schedule_agency_digests: ${error.message}`);
  }
  return parseScheduleResult(data, digestDate);
}

export function createDefaultDigestSchedulerDeps(
  logger: WorkerLogger,
): DigestSchedulerDeps {
  return {
    isEnabled: () => env.AGENCY_DIGEST_VIA_WORKER,
    pollMs: env.AGENCY_DIGEST_POLL_MS,
    batch: env.AGENCY_DIGEST_BATCH,
    localHour: AGENCY_DIGEST_LOCAL_HOUR,
    getLocalHour: (now) => getBusinessHour(now),
    getDigestDate: (now) => toBusinessDateString(now),
    schedule: callScheduleAgencyDigests,
    logger,
  };
}

/**
 * F4-001 — Agency daily digest poll loop inside the existing Node worker.
 * Runs until AbortSignal fires. Errors are logged and do not throw out of the loop.
 */
export function startDigestScheduler(
  signal: AbortSignal,
  deps: DigestSchedulerDeps,
): DigestSchedulerHandle {
  const nowFn = deps.now ?? (() => Date.now());

  const done = (async () => {
    deps.logger.info('digest_scheduler_started', {
      status: 'started',
      poll_ms: deps.pollMs,
      batch: deps.batch,
      local_hour: deps.localHour,
      agency_digest_via_worker: deps.isEnabled(),
    });

    while (!signal.aborted) {
      const tickStarted = nowFn();
      try {
        if (!deps.isEnabled()) {
          deps.logger.info('digest_scheduler_tick', {
            status: 'skipped_effect_disabled',
            duration_ms: nowFn() - tickStarted,
          });
        } else {
          const instant = new Date(nowFn());
          const hour = deps.getLocalHour(instant);
          if (hour !== deps.localHour) {
            deps.logger.info('digest_scheduler_tick', {
              status: 'skipped_outside_window',
              local_hour: hour,
              expected_hour: deps.localHour,
              duration_ms: nowFn() - tickStarted,
            });
          } else {
            const digestDate = deps.getDigestDate(instant);
            const result = await deps.schedule(deps.batch, digestDate);
            deps.logger.info('digest_scheduler_tick', {
              status: 'ok',
              scanned: result.scanned,
              emitted: result.emitted,
              batch: result.batch,
              digest_date: result.digest_date,
              duration_ms: nowFn() - tickStarted,
            });
          }
        }
      } catch (err) {
        deps.logger.error('digest_scheduler_error', {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          duration_ms: nowFn() - tickStarted,
        });
      }

      await sleep(deps.pollMs, signal);
    }

    deps.logger.info('digest_scheduler_stopped', { status: 'stopped' });
  })();

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

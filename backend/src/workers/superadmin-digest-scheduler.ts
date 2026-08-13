import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/database.js';
import {
  SUPERADMIN_DIGEST_DUE_V1_AGGREGATE,
  SUPERADMIN_DIGEST_DUE_V1_TYPE,
  superadminDigestDedupKey,
} from '../events/superadmin-digest-due.v1.js';
import { platformDigestAggregateId } from '../utils/deterministic-uuid.js';
import {
  getBusinessHour,
  toBusinessDateString,
} from '../utils/timezone.js';
import type { WorkerLogger } from './observability/logger.js';

/** S3 — send when local hour in America/Caracas is 07. */
export const SUPERADMIN_DIGEST_LOCAL_HOUR = 7;

export interface SuperadminDigestScheduleResult {
  emitted: number;
  digest_date: string;
  aggregate_id: string;
  dedup_key: string;
}

export interface SuperadminDigestSchedulerDeps {
  isEnabled: () => boolean;
  pollMs: number;
  batch: number;
  /** Local hour (0–23) in BUSINESS_TIMEZONE that opens the send window. */
  localHour: number;
  getLocalHour: (now: Date) => number;
  getDigestDate: (now: Date) => string;
  emitDueEvent: (digestDate: string) => Promise<SuperadminDigestScheduleResult>;
  logger: WorkerLogger;
  now?: () => number;
}

export interface SuperadminDigestSchedulerHandle {
  /** Resolves when the loop exits (abort or stop). */
  done: Promise<void>;
}

export async function callEmitPlatformSuperadminDigest(
  digestDate: string,
): Promise<SuperadminDigestScheduleResult> {
  const aggregateId = platformDigestAggregateId(digestDate);
  const dedupKey = superadminDigestDedupKey(digestDate);
  const { data, error } = await supabaseAdmin.rpc('emit_platform_event', {
    p_event_type: SUPERADMIN_DIGEST_DUE_V1_TYPE,
    p_aggregate_type: SUPERADMIN_DIGEST_DUE_V1_AGGREGATE,
    p_aggregate_id: aggregateId,
    p_tenant_id: null,
    p_payload: { digest_date: digestDate },
    p_dedup_key: dedupKey,
    p_available_at: new Date().toISOString(),
  });
  if (error) {
    throw new Error(`emit_platform_event: ${error.message}`);
  }
  return {
    emitted: data ? 1 : 0,
    digest_date: digestDate,
    aggregate_id: aggregateId,
    dedup_key: dedupKey,
  };
}

export function createDefaultSuperadminDigestSchedulerDeps(
  logger: WorkerLogger,
): SuperadminDigestSchedulerDeps {
  return {
    isEnabled: () => env.SUPERADMIN_DIGEST_VIA_WORKER,
    pollMs: env.SUPERADMIN_DIGEST_POLL_MS,
    batch: env.SUPERADMIN_DIGEST_BATCH,
    localHour: SUPERADMIN_DIGEST_LOCAL_HOUR,
    getLocalHour: (now) => getBusinessHour(now),
    getDigestDate: (now) => toBusinessDateString(now),
    emitDueEvent: callEmitPlatformSuperadminDigest,
    logger,
  };
}

/**
 * F4-002 — Superadmin daily digest poll loop inside the existing Node worker.
 * Independent of F4-001. Errors are logged and do not throw out of the loop.
 */
export function startSuperadminDigestScheduler(
  signal: AbortSignal,
  deps: SuperadminDigestSchedulerDeps,
): SuperadminDigestSchedulerHandle {
  const nowFn = deps.now ?? (() => Date.now());

  const done = (async () => {
    deps.logger.info('superadmin_digest_scheduler_started', {
      status: 'started',
      poll_ms: deps.pollMs,
      batch: deps.batch,
      local_hour: deps.localHour,
      superadmin_digest_via_worker: deps.isEnabled(),
    });

    while (!signal.aborted) {
      const tickStarted = nowFn();
      try {
        if (!deps.isEnabled()) {
          deps.logger.info('superadmin_digest_scheduler_tick', {
            status: 'skipped_effect_disabled',
            duration_ms: nowFn() - tickStarted,
          });
        } else {
          const instant = new Date(nowFn());
          const hour = deps.getLocalHour(instant);
          if (hour !== deps.localHour) {
            deps.logger.info('superadmin_digest_scheduler_tick', {
              status: 'skipped_outside_window',
              local_hour: hour,
              expected_hour: deps.localHour,
              duration_ms: nowFn() - tickStarted,
            });
          } else {
            const digestDate = deps.getDigestDate(instant);
            const result = await deps.emitDueEvent(digestDate);
            deps.logger.info('superadmin_digest_scheduler_tick', {
              status: 'ok',
              emitted: result.emitted,
              digest_date: result.digest_date,
              aggregate_id: result.aggregate_id,
              dedup_key: result.dedup_key,
              duration_ms: nowFn() - tickStarted,
            });
          }
        }
      } catch (err) {
        deps.logger.error('superadmin_digest_scheduler_error', {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          duration_ms: nowFn() - tickStarted,
        });
      }

      await sleep(deps.pollMs, signal);
    }

    deps.logger.info('superadmin_digest_scheduler_stopped', {
      status: 'stopped',
    });
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

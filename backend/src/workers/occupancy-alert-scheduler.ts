import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/database.js';
import type { WorkerLogger } from './observability/logger.js';

export interface OccupancyAlertCursor {
  departure_time: string;
  id: string;
}

export interface OccupancyAlertEvaluateResult {
  scanned: number;
  evaluated: number;
  emitted: number;
  skipped: number;
  skipped_invalid_occupancy: number;
  cleaned_up: number;
  batch: number;
  has_more: boolean;
  next_cursor: OccupancyAlertCursor | null;
  urgency_matches: number;
  urgency_emitted: number;
  already_escalated: number;
}

export interface OccupancyAlertSchedulerDeps {
  isEnabled: () => boolean;
  isUrgencyEnabled: () => boolean;
  pollMs: number;
  batch: number;
  evaluate: (
    batch: number,
    cursor: OccupancyAlertCursor | null,
    urgencyEnabled: boolean,
  ) => Promise<OccupancyAlertEvaluateResult>;
  logger: WorkerLogger;
  now?: () => number;
}

export interface OccupancyAlertSchedulerHandle {
  done: Promise<void>;
}

const EMPTY_RESULT: OccupancyAlertEvaluateResult = {
  scanned: 0,
  evaluated: 0,
  emitted: 0,
  skipped: 0,
  skipped_invalid_occupancy: 0,
  cleaned_up: 0,
  batch: 0,
  has_more: false,
  next_cursor: null,
  urgency_matches: 0,
  urgency_emitted: 0,
  already_escalated: 0,
};

const MAX_PAGES_PER_CYCLE = 200;

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseCursor(value: unknown): OccupancyAlertCursor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.departure_time !== 'string' || typeof row.id !== 'string') {
    return null;
  }
  return { departure_time: row.departure_time, id: row.id };
}

export function parseEvaluateResult(data: unknown): OccupancyAlertEvaluateResult {
  const row =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  return {
    scanned: asNumber(row.scanned),
    evaluated: asNumber(row.evaluated),
    emitted: asNumber(row.emitted),
    skipped: asNumber(row.skipped),
    skipped_invalid_occupancy: asNumber(row.skipped_invalid_occupancy),
    cleaned_up: asNumber(row.cleaned_up),
    batch: asNumber(row.batch),
    has_more: row.has_more === true,
    next_cursor: parseCursor(row.next_cursor),
    urgency_matches: asNumber(row.urgency_matches),
    urgency_emitted: asNumber(row.urgency_emitted),
    already_escalated: asNumber(row.already_escalated),
  };
}

export async function callEvaluateOccupancyAlerts(
  batch: number,
  cursor: OccupancyAlertCursor | null,
  urgencyEnabled: boolean,
): Promise<OccupancyAlertEvaluateResult> {
  const { data, error } = await supabaseAdmin.rpc('evaluate_occupancy_alerts', {
    p_batch: batch,
    p_after_departure: cursor?.departure_time ?? null,
    p_after_id: cursor?.id ?? null,
    p_urgency_enabled: urgencyEnabled,
  });
  if (error) {
    throw new Error(`evaluate_occupancy_alerts: ${error.message}`);
  }
  return parseEvaluateResult(data);
}

export async function runOccupancyAlertCycle(
  batch: number,
  evaluate: OccupancyAlertSchedulerDeps['evaluate'],
  urgencyEnabled: boolean,
  signal?: AbortSignal,
): Promise<OccupancyAlertEvaluateResult> {
  let cursor: OccupancyAlertCursor | null = null;
  const totals = { ...EMPTY_RESULT, batch };

  for (let page = 0; page < MAX_PAGES_PER_CYCLE; page += 1) {
    if (signal?.aborted) break;

    const result = await evaluate(batch, cursor, urgencyEnabled);
    totals.scanned += result.scanned;
    totals.evaluated += result.evaluated;
    totals.emitted += result.emitted;
    totals.skipped += result.skipped;
    totals.skipped_invalid_occupancy += result.skipped_invalid_occupancy;
    totals.cleaned_up += result.cleaned_up;
    totals.urgency_matches += result.urgency_matches;
    totals.urgency_emitted += result.urgency_emitted;
    totals.already_escalated += result.already_escalated;
    totals.batch = result.batch || batch;
    totals.has_more = result.has_more;
    totals.next_cursor = result.next_cursor;

    if (!result.has_more) break;
    if (!result.next_cursor) break;
    if (
      cursor &&
      cursor.id === result.next_cursor.id &&
      cursor.departure_time === result.next_cursor.departure_time
    ) {
      break;
    }
    cursor = result.next_cursor;
  }

  return totals;
}

export function createDefaultOccupancyAlertSchedulerDeps(
  logger: WorkerLogger,
): OccupancyAlertSchedulerDeps {
  return {
    isEnabled: () => env.OCCUPANCY_ALERT_VIA_WORKER,
    isUrgencyEnabled: () => env.OCCUPANCY_URGENCY_VIA_WORKER,
    pollMs: env.OCCUPANCY_ALERT_POLL_MS,
    batch: env.OCCUPANCY_ALERT_BATCH,
    evaluate: callEvaluateOccupancyAlerts,
    logger,
  };
}

/**
 * F4-003/F4-004 — occupancy alert (+ optional urgency) poll loop.
 * No daily hour gate. Errors are logged and do not throw out of the loop.
 */
export function startOccupancyAlertScheduler(
  signal: AbortSignal,
  deps: OccupancyAlertSchedulerDeps,
): OccupancyAlertSchedulerHandle {
  const nowFn = deps.now ?? (() => Date.now());

  const done = (async () => {
    deps.logger.info('occupancy_alert_scheduler_started', {
      status: 'started',
      poll_ms: deps.pollMs,
      batch: deps.batch,
      occupancy_alert_via_worker: deps.isEnabled(),
      occupancy_urgency_via_worker: deps.isUrgencyEnabled(),
    });

    while (!signal.aborted) {
      const tickStarted = nowFn();
      try {
        if (!deps.isEnabled()) {
          deps.logger.info('occupancy_alert_scheduler_tick', {
            status: 'skipped_effect_disabled',
            duration_ms: nowFn() - tickStarted,
          });
        } else {
          const urgencyEnabled = deps.isUrgencyEnabled();
          const result = await runOccupancyAlertCycle(
            deps.batch,
            deps.evaluate,
            urgencyEnabled,
            signal,
          );
          deps.logger.info('occupancy_alert_scheduler_tick', {
            status: 'ok',
            scanned: result.scanned,
            evaluated: result.evaluated,
            emitted: result.emitted,
            skipped: result.skipped,
            skipped_invalid_occupancy: result.skipped_invalid_occupancy,
            cleaned_up: result.cleaned_up,
            urgency_matches: result.urgency_matches,
            urgency_emitted: result.urgency_emitted,
            already_escalated: result.already_escalated,
            duration_ms: nowFn() - tickStarted,
          });
        }
      } catch (err) {
        deps.logger.error('occupancy_alert_scheduler_error', {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          duration_ms: nowFn() - tickStarted,
        });
      }

      await sleep(deps.pollMs, signal);
    }

    deps.logger.info('occupancy_alert_scheduler_stopped', { status: 'stopped' });
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

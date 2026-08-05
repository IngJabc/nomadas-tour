import type { OutboxEventRow } from '../../events/types.js';
import { correlationFromRow } from '../observability/context.js';
import type { WorkerLogger } from '../observability/logger.js';
import { retryDelayMs } from './retry.js';
import type { RelayDeps, RelayLoopOptions } from './types.js';

function resolveLogger(deps: RelayDeps): WorkerLogger | null {
  if (deps.logger) return deps.logger;
  if (!deps.log) return null;
  const legacy = deps.log;
  return {
    info: (event, fields) => legacy(event, fields),
    warn: (event, fields) => legacy(event, fields),
    error: (event, fields) => legacy(event, fields),
    child: () => resolveLogger(deps)!,
  };
}

function isSkipReason(reason: string): boolean {
  return reason === 'already_sent' || reason === 'skipped_no_email';
}

export async function processClaimedEvent(
  row: OutboxEventRow,
  deps: RelayDeps,
): Promise<void> {
  const logger = resolveLogger(deps);
  const metrics = deps.metrics;
  const corr = correlationFromRow(row);
  const started = (deps.now?.() ?? new Date()).getTime();

  metrics?.beginProcessing();
  logger?.info('outbox_processing_started', {
    ...corr,
    status: 'processing',
  });

  const finish = (status: string, extra?: Record<string, unknown>) => {
    const duration_ms = (deps.now?.() ?? new Date()).getTime() - started;
    metrics?.endProcessing(duration_ms);
    return { duration_ms, status, ...extra };
  };

  const handler = deps.getHandler(row.event_type, row.event_version);

  if (!handler) {
    await deps.markFailed(
      row.id,
      `No handler for ${row.event_type}.v${row.event_version}`,
    );
    metrics?.incFailed();
    logger?.error('outbox_failed', {
      ...corr,
      ...finish('failed'),
      reason: 'no_handler',
    });
    return;
  }

  try {
    const outcome = await handler(row);

    if (outcome.kind === 'completed') {
      await deps.markCompleted(row.id);
      metrics?.incProcessed();
      if (isSkipReason(outcome.reason)) {
        metrics?.incSkipped();
      }
      logger?.info('outbox_completed', {
        ...corr,
        ...finish('completed'),
        reason: outcome.reason,
      });
      return;
    }

    if (outcome.kind === 'failed' && outcome.permanent) {
      await deps.markFailed(row.id, outcome.reason);
      metrics?.incFailed();
      logger?.error('outbox_failed', {
        ...corr,
        ...finish('failed'),
        reason: outcome.reason,
      });
      return;
    }

    // requeue or non-permanent failed
    if (row.attempts >= deps.maxAttempts) {
      await deps.markFailed(
        row.id,
        `Max attempts (${deps.maxAttempts}): ${outcome.kind === 'requeue' ? outcome.reason : outcome.reason}`,
      );
      metrics?.incFailed();
      logger?.error('outbox_failed', {
        ...corr,
        ...finish('failed'),
        reason: 'max_attempts',
        error:
          outcome.kind === 'requeue' ? outcome.reason : outcome.reason,
      });
      return;
    }

    const delayMs =
      outcome.kind === 'requeue'
        ? outcome.delayMs
        : retryDelayMs(row.attempts, deps.retryBaseMs);
    const availableAt = new Date(
      (deps.now?.() ?? new Date()).getTime() + delayMs,
    ).toISOString();
    const reason =
      outcome.kind === 'requeue' ? outcome.reason : outcome.reason;

    await deps.markRequeue(row.id, reason, availableAt);
    metrics?.incRetried();
    logger?.warn('outbox_requeued', {
      ...corr,
      ...finish('requeued'),
      reason,
      available_at: availableAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    metrics?.markError();
    logger?.error('handler_error', {
      ...corr,
      status: 'error',
      error: message,
      duration_ms: (deps.now?.() ?? new Date()).getTime() - started,
    });

    if (row.attempts >= deps.maxAttempts) {
      await deps.markFailed(row.id, `Max attempts: ${message}`);
      metrics?.incFailed();
      logger?.error('outbox_failed', {
        ...corr,
        ...finish('failed'),
        reason: 'max_attempts',
        error: message,
      });
      return;
    }
    const delayMs = retryDelayMs(row.attempts, deps.retryBaseMs);
    const availableAt = new Date(
      (deps.now?.() ?? new Date()).getTime() + delayMs,
    ).toISOString();
    await deps.markRequeue(row.id, message, availableAt);
    metrics?.incRetried();
    logger?.warn('outbox_requeued', {
      ...corr,
      ...finish('requeued'),
      reason: 'handler_exception',
      error: message,
      available_at: availableAt,
    });
  }
}

export async function runOutboxRelayOnce(
  deps: RelayDeps & { batchSize: number; eventType?: string | null },
): Promise<number> {
  const logger = resolveLogger(deps);

  if (deps.recoverStuck) {
    try {
      const recovered_count = await deps.recoverStuck();
      if (recovered_count > 0) {
        logger?.warn('outbox_recovery_completed', {
          status: 'recovered',
          recovered_count,
          // alias for earlier WKR-006.1 docs / log scrapers
          recovered: recovered_count,
          event_alias: 'outbox_recovered_stuck',
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.metrics?.markError();
      logger?.error('outbox_recover_stuck_error', {
        status: 'error',
        error: message,
      });
    }
  }

  const claimed = await deps.claimEvents(
    deps.batchSize,
    deps.eventType === undefined ? 'reservation.created' : deps.eventType,
  );

  if (claimed.length > 0) {
    logger?.info('outbox_claimed', {
      status: 'claimed',
      claimed: claimed.length,
      event_type:
        deps.eventType === undefined
          ? 'reservation.created'
          : deps.eventType,
    });
  }

  for (const row of claimed) {
    await processClaimedEvent(row, deps);
  }

  return claimed.length;
}

export async function runOutboxRelayLoop(
  deps: RelayDeps & {
    batchSize: number;
    pollMs: number;
    eventType?: string | null;
  },
  options: RelayLoopOptions = {},
): Promise<void> {
  const logger = resolveLogger(deps);

  logger?.info('outbox_relay_started', {
    status: 'started',
    batch_size: deps.batchSize,
    poll_ms: deps.pollMs,
  });

  while (!options.signal?.aborted) {
    try {
      options.onLoopTick?.();
      const n = await runOutboxRelayOnce(deps);
      if (n === 0) {
        await sleep(deps.pollMs, options.signal);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger?.error('outbox_relay_loop_error', {
        status: 'error',
        error: message,
      });
      await sleep(deps.pollMs, options.signal);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

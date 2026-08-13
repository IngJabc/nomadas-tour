import type {
  CompletedHandlerReason,
  HandlerOutcome,
  OutboxHandler,
} from '../outbox/types.js';

const COMPLETED_REASON_PRIORITY: Record<CompletedHandlerReason, number> = {
  sent: 3,
  delivered: 3,
  already_sent: 2,
  already_delivered: 2,
  skipped_no_email: 1,
  skipped_restricted: 1,
  skipped_disabled: 1,
  skipped_no_agencies: 1,
  skipped_effect_disabled: 1,
  skipped_empty: 1,
};

function preferCompletedOutcome(
  current: Extract<HandlerOutcome, { kind: 'completed' }> | null,
  candidate: Extract<HandlerOutcome, { kind: 'completed' }>,
): Extract<HandlerOutcome, { kind: 'completed' }> {
  if (!current) return candidate;
  return COMPLETED_REASON_PRIORITY[candidate.reason] >
    COMPLETED_REASON_PRIORITY[current.reason]
    ? candidate
    : current;
}

/**
 * Runs handlers sequentially for the same outbox event.
 *
 * All handlers run so independent consumers can make progress. The aggregate
 * precedence is: permanent failure, requeue, retryable failure, completed.
 * On retry, completed handlers run again, so every composed handler must be
 * idempotent. Handler exceptions intentionally propagate to the relay, which
 * applies its existing retry / max-attempt semantics.
 */
export function composeHandlers(...handlers: OutboxHandler[]): OutboxHandler {
  if (handlers.length === 0) {
    throw new Error('composeHandlers requires at least one handler');
  }

  return async (row) => {
    let completed: Extract<HandlerOutcome, { kind: 'completed' }> | null = null;
    let permanentFailure: Extract<
      HandlerOutcome,
      { kind: 'failed' }
    > | null = null;
    let requeue: Extract<HandlerOutcome, { kind: 'requeue' }> | null = null;
    let retryableFailure: Extract<
      HandlerOutcome,
      { kind: 'failed' }
    > | null = null;

    for (const handler of handlers) {
      const outcome = await handler(row);
      if (outcome.kind === 'completed') {
        completed = preferCompletedOutcome(completed, outcome);
      } else if (outcome.kind === 'requeue') {
        requeue ??= outcome;
      } else if (outcome.permanent) {
        permanentFailure ??= outcome;
      } else {
        retryableFailure ??= outcome;
      }
    }

    if (permanentFailure) return permanentFailure;
    if (requeue) return requeue;
    if (retryableFailure) return retryableFailure;
    return completed!;
  };
}

import type { OutboxEventRow } from '../../events/types.js';
import type { WorkerLogger } from '../observability/logger.js';
import type { WorkerMetrics } from '../observability/metrics.js';

export type CompletedHandlerReason =
  | 'sent'
  | 'already_sent'
  | 'skipped_no_email'
  | 'skipped_restricted'
  | 'skipped_disabled'
  | 'skipped_no_agencies'
  | 'skipped_effect_disabled'
  | 'skipped_empty'
  | 'delivered'
  | 'already_delivered';

export type HandlerOutcome =
  | { kind: 'completed'; reason: CompletedHandlerReason }
  | { kind: 'requeue'; reason: string; delayMs: number }
  | { kind: 'failed'; reason: string; permanent: boolean };

export type OutboxHandler = (row: OutboxEventRow) => Promise<HandlerOutcome>;

export interface RelayDeps {
  claimEvents: (limit: number, eventType: string | null) => Promise<OutboxEventRow[]>;
  markCompleted: (id: string) => Promise<void>;
  markFailed: (id: string, errorMessage: string) => Promise<void>;
  markRequeue: (
    id: string,
    errorMessage: string,
    availableAt: string,
  ) => Promise<void>;
  getHandler: (eventType: string, eventVersion: number) => OutboxHandler | null;
  now?: () => Date;
  maxAttempts: number;
  retryBaseMs: number;
  /** @deprecated Prefer `logger`. Kept for backward-compatible tests. */
  log?: (message: string, meta?: Record<string, unknown>) => void;
  logger?: WorkerLogger;
  metrics?: WorkerMetrics;
  /** Recover stale processing rows; returns recovered count. */
  recoverStuck?: () => Promise<number>;
}

export interface RelayLoopOptions {
  signal?: AbortSignal;
  /** Emit structured heartbeat (interval handled by controller). */
  onLoopTick?: () => void;
}

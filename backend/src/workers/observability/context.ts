import type { OutboxEventRow } from '../../events/types.js';

/** Correlation fields derived from an outbox row. Never includes payload/PII. */
export interface OutboxCorrelationFields {
  event_id: string;
  event_type: string;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string;
  tenant_id: string | null;
  agency_id: string | null;
  handler: string;
  attempts: number;
}

export function handlerKey(eventType: string, eventVersion: number): string {
  return `${eventType}:${eventVersion}`;
}

export function correlationFromRow(row: OutboxEventRow): OutboxCorrelationFields {
  return {
    event_id: row.id,
    event_type: row.event_type,
    event_version: row.event_version,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    tenant_id: row.tenant_id,
    agency_id: row.tenant_id,
    handler: handlerKey(row.event_type, row.event_version),
    attempts: row.attempts,
  };
}

/** Shared domain-event envelope (WKR-002 / WKR-003 / WKR-004). */

export interface EventTenant {
  agency_id: string | null;
}

export interface EventAggregate {
  type: string;
  id: string;
}

export interface EventEnvelope<TData> {
  id: string;
  type: string;
  version: number;
  occurred_at: string;
  tenant: EventTenant;
  aggregate: EventAggregate;
  data: TData;
}

/** Row shape stored in public.outbox_events (worker / relay input). */
export interface OutboxEventRow {
  id: string;
  event_type: string;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string;
  tenant_id: string | null;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  available_at: string;
  processed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  /** WKR-007 Fase 0. NULL until producers set a key (trigger 049 stays NULL until WKR-007.2). */
  dedup_key?: string | null;
}

export function envelopeFromOutboxRow<TData>(
  row: OutboxEventRow,
  data: TData,
): EventEnvelope<TData> {
  return {
    id: row.id,
    type: row.event_type,
    version: row.event_version,
    occurred_at: row.created_at,
    tenant: { agency_id: row.tenant_id },
    aggregate: {
      type: row.aggregate_type,
      id: row.aggregate_id,
    },
    data,
  };
}

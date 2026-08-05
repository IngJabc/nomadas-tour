import { supabaseAdmin } from '../../config/database.js';
import type { OutboxEventRow } from '../../events/types.js';

export async function claimOutboxEvents(
  limit: number,
  eventType: string | null = 'reservation.created',
): Promise<OutboxEventRow[]> {
  const { data, error } = await supabaseAdmin.rpc('claim_outbox_events', {
    p_limit: limit,
    p_event_type: eventType,
  });

  if (error) {
    throw new Error(`claim_outbox_events failed: ${error.message}`);
  }

  return (data || []) as OutboxEventRow[];
}

/** Requeue stale `processing` rows (worker crash / deploy). SKIP LOCKED. */
export async function recoverStuckOutboxEvents(
  staleMs: number,
  limit: number,
): Promise<OutboxEventRow[]> {
  const { data, error } = await supabaseAdmin.rpc(
    'recover_stuck_outbox_events',
    {
      p_stale_ms: staleMs,
      p_limit: limit,
    },
  );

  if (error) {
    throw new Error(`recover_stuck_outbox_events failed: ${error.message}`);
  }

  return (data || []) as OutboxEventRow[];
}

export async function markOutboxCompleted(id: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('outbox_events')
    .update({
      status: 'completed',
      processed_at: now,
      updated_at: now,
      error_message: null,
    })
    .eq('id', id)
    .eq('status', 'processing');

  if (error) {
    throw new Error(`markOutboxCompleted failed: ${error.message}`);
  }
}

export async function markOutboxFailed(
  id: string,
  errorMessage: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('outbox_events')
    .update({
      status: 'failed',
      processed_at: now,
      updated_at: now,
      error_message: errorMessage.slice(0, 2000),
    })
    .eq('id', id)
    .eq('status', 'processing');

  if (error) {
    throw new Error(`markOutboxFailed failed: ${error.message}`);
  }
}

export async function markOutboxRequeue(
  id: string,
  errorMessage: string,
  availableAt: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('outbox_events')
    .update({
      status: 'pending',
      available_at: availableAt,
      updated_at: now,
      error_message: errorMessage.slice(0, 2000),
      processed_at: null,
    })
    .eq('id', id)
    .eq('status', 'processing');

  if (error) {
    throw new Error(`markOutboxRequeue failed: ${error.message}`);
  }
}

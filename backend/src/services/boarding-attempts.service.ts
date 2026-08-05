import { createHash } from 'node:crypto';
import { supabaseAdmin } from '../config/database.js';
import type { BoardingAttemptInput } from '../types/boarding.js';

/** SHA-256 hex of normalized credential. Never store plaintext QR/ticket. */
export function hashBoardingCredential(normalizedInput: string): string {
  return createHash('sha256').update(normalizedInput, 'utf8').digest('hex');
}

/**
 * Best-effort telemetry. Must never break the boarding critical path.
 */
export async function recordBoardingAttempt(
  input: BoardingAttemptInput,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('boarding_attempts').insert({
      actor_user_id: input.actor_user_id,
      operator_agency_id: input.operator_agency_id,
      trip_id: input.trip_id ?? null,
      reservation_id: input.reservation_id ?? null,
      reservation_passenger_id: input.reservation_passenger_id ?? null,
      operation: input.operation,
      outcome: input.outcome,
      failure_code: input.failure_code ?? null,
      credential_hash: input.credential_hash ?? null,
    });

    if (error) {
      console.error(
        JSON.stringify({
          event: 'BOARDING_ATTEMPT_FAILED',
          operation: input.operation,
          outcome: input.outcome,
          error: error.message,
        }),
      );
    }
  } catch (err: any) {
    console.error(
      JSON.stringify({
        event: 'BOARDING_ATTEMPT_FAILED',
        operation: input.operation,
        outcome: input.outcome,
        error: err?.message ?? String(err),
      }),
    );
  }
}

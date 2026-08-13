import { env } from '../../config/env.js';
import { supabaseAdmin } from '../../config/database.js';
import {
  parseSuperadminDigestDueEventV1,
  type SuperadminDigestDueEventV1,
} from '../../events/superadmin-digest-due.v1.js';
import type { OutboxEventRow } from '../../events/types.js';
import {
  isSuperadminDigestEmpty,
  loadEligibleSuperadmins,
  loadSuperadminDigestAggregates,
  type SuperadminDigestAggregates,
  type SuperadminDigestRecipient,
} from '../../services/superadmin-digest.service.js';
import type { EmailSendResult } from '../../services/email.service.js';
import { emailService } from '../../services/email.service.js';
import type {
  CompletedHandlerReason,
  HandlerOutcome,
  OutboxHandler,
} from '../outbox/types.js';

export type SuperadminDigestEmailType = 'superadmin_digest';

export interface SuperadminDigestFanoutDeps {
  isEffectsEnabled: () => boolean;
  batch: number;
  loadAggregates: (
    digestDate: string,
  ) => Promise<SuperadminDigestAggregates>;
  loadRecipients: () => Promise<SuperadminDigestRecipient[]>;
  claimDelivery: (params: {
    eventId: string;
    recipientId: string;
    emailType: SuperadminDigestEmailType;
  }) => Promise<'claimed' | 'already_logged'>;
  markDeliverySent: (params: {
    eventId: string;
    recipientId: string;
    emailType: SuperadminDigestEmailType;
  }) => Promise<void>;
  releaseDeliveryClaim: (params: {
    eventId: string;
    recipientId: string;
    emailType: SuperadminDigestEmailType;
  }) => Promise<void>;
  sendSuperadminDigestEmail: (
    to: string,
    aggregates: SuperadminDigestAggregates,
  ) => Promise<EmailSendResult>;
}

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

function preferCompleted(
  current: CompletedHandlerReason | null,
  candidate: CompletedHandlerReason,
): CompletedHandlerReason {
  if (!current) return candidate;
  return COMPLETED_REASON_PRIORITY[candidate] >
    COMPLETED_REASON_PRIORITY[current]
    ? candidate
    : current;
}

export function createDefaultSuperadminDigestFanoutDeps(): SuperadminDigestFanoutDeps {
  return {
    isEffectsEnabled: () => env.SUPERADMIN_DIGEST_VIA_WORKER,
    batch: env.SUPERADMIN_DIGEST_BATCH ?? 50,
    loadAggregates: loadSuperadminDigestAggregates,
    loadRecipients: loadEligibleSuperadmins,
    async claimDelivery({ eventId, recipientId, emailType }) {
      const { data, error } = await supabaseAdmin
        .from('email_delivery_log')
        .insert({
          event_id: eventId,
          recipient_id: recipientId,
          email_type: emailType,
          status: 'pending',
          attempts: 0,
        })
        .select('event_id')
        .maybeSingle();

      if (error) {
        if ((error as { code?: string }).code === '23505') {
          return 'already_logged';
        }
        throw new Error(`claimDelivery: ${error.message}`);
      }
      return data ? 'claimed' : 'already_logged';
    },
    async markDeliverySent({ eventId, recipientId, emailType }) {
      const { error } = await supabaseAdmin
        .from('email_delivery_log')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          attempts: 1,
          updated_at: new Date().toISOString(),
        })
        .eq('event_id', eventId)
        .eq('recipient_id', recipientId)
        .eq('email_type', emailType);

      if (error) throw new Error(`markDeliverySent: ${error.message}`);
    },
    async releaseDeliveryClaim({ eventId, recipientId, emailType }) {
      const { error } = await supabaseAdmin
        .from('email_delivery_log')
        .delete()
        .eq('event_id', eventId)
        .eq('recipient_id', recipientId)
        .eq('email_type', emailType)
        .eq('status', 'pending');

      if (error) throw new Error(`releaseDeliveryClaim: ${error.message}`);
    },
    sendSuperadminDigestEmail: (to, aggregates) =>
      emailService.sendSuperadminDigestEmail(to, aggregates),
  };
}

/**
 * F4-002 — Superadmin digest email handler for superadmin.digest.due.v1.
 * Gated by SUPERADMIN_DIGEST_VIA_WORKER. Email only — no in-app fanout.
 * Ledger: recipient_id = users.id, email_type = superadmin_digest.
 */
export function createSuperadminDigestFanoutHandler(
  deps: SuperadminDigestFanoutDeps = createDefaultSuperadminDigestFanoutDeps(),
): OutboxHandler {
  return async function handleSuperadminDigestFanout(
    row: OutboxEventRow,
  ): Promise<HandlerOutcome> {
    if (!deps.isEffectsEnabled()) {
      return { kind: 'completed', reason: 'skipped_effect_disabled' };
    }

    let parsed: SuperadminDigestDueEventV1;
    try {
      parsed = parseSuperadminDigestDueEventV1(row);
    } catch (err) {
      return {
        kind: 'failed',
        permanent: true,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    const emailType: SuperadminDigestEmailType = 'superadmin_digest';

    let aggregates: SuperadminDigestAggregates;
    try {
      aggregates = await deps.loadAggregates(parsed.data.digest_date);
    } catch (err) {
      return {
        kind: 'failed',
        permanent: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    if (isSuperadminDigestEmpty(aggregates)) {
      return { kind: 'completed', reason: 'skipped_empty' };
    }

    let recipients: SuperadminDigestRecipient[];
    try {
      recipients = await deps.loadRecipients();
    } catch (err) {
      return {
        kind: 'failed',
        permanent: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    if (recipients.length === 0) {
      return { kind: 'completed', reason: 'skipped_no_email' };
    }

    // Progress cursor is email_delivery_log (already_logged), not a list offset.
    // already_logged rows do not consume the batch; unsent recipients later in
    // the list are reached on retry of the same daily event.
    const batchLimit = deps.batch > 0 ? deps.batch : Number.POSITIVE_INFINITY;
    let newClaims = 0;
    let hasUnseenRecipients = false;
    let completedReason: CompletedHandlerReason | null = null;
    let retryableFailure: string | null = null;

    for (const recipient of recipients) {
      if (newClaims >= batchLimit) {
        hasUnseenRecipients = true;
        break;
      }

      const outcome = await deliverOne({
        deps,
        eventId: row.id,
        recipientId: recipient.user_id,
        emailType,
        send: () =>
          deps.sendSuperadminDigestEmail(recipient.email, aggregates),
      });
      if (outcome.consumedBatchSlot) {
        newClaims += 1;
      }
      if (outcome.retryableFailure) {
        retryableFailure ??= outcome.retryableFailure;
      }
      if (outcome.completedReason) {
        completedReason = preferCompleted(
          completedReason,
          outcome.completedReason,
        );
      }
    }

    if (retryableFailure) {
      return {
        kind: 'failed',
        permanent: false,
        reason: retryableFailure,
      };
    }

    if (hasUnseenRecipients) {
      return {
        kind: 'failed',
        permanent: false,
        reason: 'recipient_batch_remaining',
      };
    }

    return {
      kind: 'completed',
      reason: completedReason ?? 'skipped_no_email',
    };
  };
}

async function deliverOne(params: {
  deps: SuperadminDigestFanoutDeps;
  eventId: string;
  recipientId: string;
  emailType: SuperadminDigestEmailType;
  send: () => Promise<EmailSendResult>;
}): Promise<{
  completedReason: CompletedHandlerReason | null;
  retryableFailure: string | null;
  consumedBatchSlot: boolean;
}> {
  const { deps, eventId, recipientId, emailType, send } = params;

  let claim: 'claimed' | 'already_logged';
  try {
    claim = await deps.claimDelivery({ eventId, recipientId, emailType });
  } catch (err) {
    return {
      completedReason: null,
      retryableFailure: err instanceof Error ? err.message : String(err),
      consumedBatchSlot: false,
    };
  }

  if (claim === 'already_logged') {
    return {
      completedReason: 'already_sent',
      retryableFailure: null,
      consumedBatchSlot: false,
    };
  }

  try {
    const result = await send();

    if (result.status === 'skipped') {
      await deps.releaseDeliveryClaim({ eventId, recipientId, emailType });
      return {
        completedReason:
          result.reason === 'disabled'
            ? 'skipped_disabled'
            : 'skipped_restricted',
        retryableFailure: null,
        consumedBatchSlot: true,
      };
    }

    await deps.markDeliverySent({ eventId, recipientId, emailType });
    return {
      completedReason: 'sent',
      retryableFailure: null,
      consumedBatchSlot: true,
    };
  } catch (err) {
    try {
      await deps.releaseDeliveryClaim({ eventId, recipientId, emailType });
    } catch {
      // Prefer surfacing the send failure; release is best-effort.
    }
    return {
      completedReason: null,
      retryableFailure: err instanceof Error ? err.message : String(err),
      consumedBatchSlot: true,
    };
  }
}

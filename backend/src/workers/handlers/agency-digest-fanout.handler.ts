import { env } from '../../config/env.js';
import { supabaseAdmin } from '../../config/database.js';
import {
  parseAgencyDigestDueEventV1,
  type AgencyDigestDueEventV1,
} from '../../events/agency-digest-due.v1.js';
import type { OutboxEventRow } from '../../events/types.js';
import {
  loadAgencyDigestAggregates,
  type AgencyDigestAggregates,
} from '../../services/agency-digest.service.js';
import type { EmailSendResult } from '../../services/email.service.js';
import { emailService } from '../../services/email.service.js';
import { notificationDeliveryPolicy } from '../../services/notification-delivery.policy.js';
import type {
  HandlerOutcome,
  OutboxHandler,
} from '../outbox/types.js';

export type AgencyDigestEmailType = 'agency_digest';

export interface AgencyDigestFanoutDeps {
  isEffectsEnabled: () => boolean;
  shouldDeliverAgencyEmail: (agencyId: string) => Promise<boolean>;
  loadAggregates: (
    agencyId: string,
    digestDate: string,
  ) => Promise<AgencyDigestAggregates | null>;
  claimDelivery: (params: {
    eventId: string;
    recipientId: string;
    emailType: AgencyDigestEmailType;
  }) => Promise<'claimed' | 'already_logged'>;
  markDeliverySent: (params: {
    eventId: string;
    recipientId: string;
    emailType: AgencyDigestEmailType;
  }) => Promise<void>;
  releaseDeliveryClaim: (params: {
    eventId: string;
    recipientId: string;
    emailType: AgencyDigestEmailType;
  }) => Promise<void>;
  sendAgencyDigestEmail: (
    to: string,
    aggregates: AgencyDigestAggregates,
  ) => Promise<EmailSendResult>;
}

export function createDefaultAgencyDigestFanoutDeps(): AgencyDigestFanoutDeps {
  return {
    isEffectsEnabled: () => env.AGENCY_DIGEST_VIA_WORKER,
    shouldDeliverAgencyEmail: (agencyId) =>
      notificationDeliveryPolicy.shouldDeliver(agencyId, 'ops_digest', 'email'),
    loadAggregates: loadAgencyDigestAggregates,
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
    sendAgencyDigestEmail: (to, aggregates) =>
      emailService.sendAgencyDigestEmail(to, aggregates),
  };
}

/**
 * F4-001 — Agency digest email handler for agency.digest.due.v1.
 * Gated by AGENCY_DIGEST_VIA_WORKER. Uses email_delivery_log claim→send→sent.
 */
export function createAgencyDigestFanoutHandler(
  deps: AgencyDigestFanoutDeps = createDefaultAgencyDigestFanoutDeps(),
): OutboxHandler {
  return async function handleAgencyDigestFanout(
    row: OutboxEventRow,
  ): Promise<HandlerOutcome> {
    if (!deps.isEffectsEnabled()) {
      return { kind: 'completed', reason: 'skipped_effect_disabled' };
    }

    let parsed: AgencyDigestDueEventV1;
    try {
      parsed = parseAgencyDigestDueEventV1(row);
    } catch (err) {
      return {
        kind: 'failed',
        permanent: true,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    const agencyId = parsed.data.agency_id;
    const emailType: AgencyDigestEmailType = 'agency_digest';

    let allowed: boolean;
    try {
      allowed = await deps.shouldDeliverAgencyEmail(agencyId);
    } catch (err) {
      return {
        kind: 'failed',
        permanent: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
    if (!allowed) {
      return { kind: 'completed', reason: 'skipped_disabled' };
    }

    let aggregates: AgencyDigestAggregates | null;
    try {
      aggregates = await deps.loadAggregates(
        agencyId,
        parsed.data.digest_date,
      );
    } catch (err) {
      return {
        kind: 'failed',
        permanent: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    if (!aggregates) {
      return { kind: 'completed', reason: 'skipped_no_email' };
    }

    // Tenancy guard: aggregates must belong to the event agency.
    if (aggregates.agency_id !== agencyId) {
      return {
        kind: 'failed',
        permanent: true,
        reason: 'tenancy_mismatch: aggregates.agency_id != event agency_id',
      };
    }

    let claim: 'claimed' | 'already_logged';
    try {
      claim = await deps.claimDelivery({
        eventId: row.id,
        recipientId: agencyId,
        emailType,
      });
    } catch (err) {
      return {
        kind: 'failed',
        permanent: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    if (claim === 'already_logged') {
      return { kind: 'completed', reason: 'already_sent' };
    }

    try {
      const result = await deps.sendAgencyDigestEmail(
        aggregates.agency_email,
        aggregates,
      );

      if (result.status === 'skipped') {
        await deps.releaseDeliveryClaim({
          eventId: row.id,
          recipientId: agencyId,
          emailType,
        });
        return {
          kind: 'completed',
          reason:
            result.reason === 'disabled'
              ? 'skipped_disabled'
              : 'skipped_restricted',
        };
      }

      await deps.markDeliverySent({
        eventId: row.id,
        recipientId: agencyId,
        emailType,
      });
      return { kind: 'completed', reason: 'sent' };
    } catch (err) {
      try {
        await deps.releaseDeliveryClaim({
          eventId: row.id,
          recipientId: agencyId,
          emailType,
        });
      } catch {
        // Prefer surfacing the send failure; release is best-effort.
      }
      return {
        kind: 'failed',
        permanent: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

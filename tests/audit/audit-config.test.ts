import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTION_CONFIG,
  getAuditActionConfig,
} from '@/components/audit/audit-config';
import { AUDIT_ACTIONS, type AuditEventDTO } from '@/types/audit';

function event(partial: Partial<AuditEventDTO> = {}): AuditEventDTO {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    occurred_at: '2026-08-15T12:00:00.000Z',
    action: 'trip.created',
    entity_type: 'trip',
    entity_id: '11111111-1111-4111-8111-111111111111',
    agency_id: null,
    actor: null,
    before: null,
    after: null,
    metadata: {},
    ...partial,
  };
}

describe('audit-config', () => {
  it('covers all actions with label/icon/tone/entityLabel/summarize', () => {
    expect(AUDIT_ACTIONS).toHaveLength(15);
    for (const action of AUDIT_ACTIONS) {
      const cfg = AUDIT_ACTION_CONFIG[action];
      expect(cfg.label).toBeTruthy();
      expect(cfg.icon).toBeTruthy();
      expect(cfg.tone).toBeTruthy();
      expect(cfg.entityLabel).toBeTruthy();
      expect(() => cfg.summarize(event({ action }))).not.toThrow();
    }
  });

  it('summarize is defensive with null before/after/metadata', () => {
    const cfg = getAuditActionConfig('reservation.created');
    expect(
      cfg.summarize(
        event({
          action: 'reservation.created',
          before: null,
          after: null,
          metadata: {},
        }),
      ),
    ).toBeNull();
  });

  it('summarize reservation.created seats and boarding seat', () => {
    expect(
      getAuditActionConfig('reservation.created').summarize(
        event({
          action: 'reservation.created',
          after: { passenger_count: 2, seat_codes: ['A1', 'A2'] },
        }),
      ),
    ).toContain('2 pasajeros');

    expect(
      getAuditActionConfig('boarding.board').summarize(
        event({
          action: 'boarding.board',
          metadata: { seat_code: 'A5' },
        }),
      ),
    ).toBe('Asiento A5');
  });
});

import { describe, expect, it } from 'vitest';

/**
 * Forbidden JSON keys that must never appear as PII/secrets in audit payloads.
 * Note: notification_preferences.updated uses boolean channel key `email`
 * (sibling of `in_app`) — that is not contact PII.
 */
const FORBIDDEN_AUDIT_KEYS = [
  'name',
  'document',
  'phone',
  'email',
  'contact_email',
  'qr_code',
  'ticket_code',
  'password',
  'password_hash',
  'token',
  'authorization',
  'cookie',
] as const;

type Hit = { key: string; value: unknown };

function collectForbiddenHits(
  value: unknown,
  hits: Hit[] = [],
): Hit[] {
  if (Array.isArray(value)) {
    for (const item of value) collectForbiddenHits(item, hits);
    return hits;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if ((FORBIDDEN_AUDIT_KEYS as readonly string[]).includes(key)) {
        const isChannelEmail = key === 'email' && typeof v === 'boolean';
        if (!isChannelEmail) {
          hits.push({ key, value: v });
        }
      }
      collectForbiddenHits(v, hits);
    }
  }
  return hits;
}

describe('F5-001 audit PII key policy (unit)', () => {
  it('flags forbidden keys across trip/reservation/boarding/settings shapes', () => {
    const samples = [
      {
        action: 'trip.created',
        before: null,
        after: {
          route_id: 'r1',
          departure_time: '2026-01-01T00:00:00Z',
          vehicle_type: 'bus',
          capacity: 31,
        },
        metadata: { source: 'api' },
      },
      {
        action: 'reservation.created',
        before: null,
        after: {
          trip_id: 't1',
          passenger_count: 2,
          seat_codes: ['A1', 'A2'],
        },
        metadata: { source: 'api' },
      },
      {
        action: 'reservation.cancelled',
        before: { status: 'confirmed' },
        after: { status: 'cancelled' },
        metadata: { source: 'api', freed_seat_count: 2 },
      },
      {
        action: 'boarding.board',
        before: null,
        after: null,
        metadata: { seat_code: 'A1', source: 'api' },
      },
      {
        action: 'agency_settings.updated',
        before: { accent_color: '#00D4FF' },
        after: { accent_color: '#0080FF' },
        metadata: { source: 'api' },
      },
      {
        action: 'notification_preferences.updated',
        before: { trip_reminders: { in_app: true, email: true } },
        after: { trip_reminders: { in_app: false, email: false } },
        metadata: { source: 'api' },
      },
    ];

    for (const sample of samples) {
      const hits = collectForbiddenHits({
        before: sample.before,
        after: sample.after,
        metadata: sample.metadata,
      });
      expect(hits, `${sample.action} leaked ${JSON.stringify(hits)}`).toEqual(
        [],
      );
    }
  });

  it('fails when a forbidden key sneaks into after/metadata', () => {
    const hits = collectForbiddenHits({
      after: { seat_codes: ['A1'], contact_email: 'x@y.com' },
      metadata: { source: 'api', authorization: 'Bearer x' },
    });
    expect(hits.map((h) => h.key).sort()).toEqual([
      'authorization',
      'contact_email',
    ]);
  });
});

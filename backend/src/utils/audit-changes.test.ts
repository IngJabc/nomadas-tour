import { describe, expect, it } from 'vitest';
import { sanitizeAuditChanges } from './audit-changes.js';

const PII_POLLUTION = {
  name: 'Secret Person',
  document: 'V123',
  phone: '+58000',
  email: 'secret@example.com',
  contact_email: 'booker@example.com',
  qr_code: 'QR-SECRET',
  ticket_code: 'TKT-SECRET',
  password: 'pw',
  token: 'tok',
  authorization: 'Bearer x',
  cookie: 'sid=1',
};

describe('sanitizeAuditChanges (F5-002.1 F-2)', () => {
  it('keeps allowlisted trip fields', () => {
    const { after } = sanitizeAuditChanges(
      'trip.created',
      null,
      {
        route_id: 'r1',
        departure_time: '2026-08-15T12:00:00.000Z',
        capacity: 31,
        vehicle_type: 'bus',
        email: 'nope@example.com',
      },
    );
    expect(after).toEqual({
      route_id: 'r1',
      departure_time: '2026-08-15T12:00:00.000Z',
      capacity: 31,
      vehicle_type: 'bus',
    });
  });

  it('keeps status for cancel actions and drops unknown keys', () => {
    const { before, after } = sanitizeAuditChanges(
      'reservation.cancelled',
      {
        status: 'confirmed',
        email: 'secret@example.com',
        custom_secret: '...',
      },
      {
        status: 'cancelled',
        email: 'secret@example.com',
        custom_secret: '...',
      },
    );
    expect(before).toEqual({ status: 'confirmed' });
    expect(after).toEqual({ status: 'cancelled' });
  });

  it('forces boarding before/after to null', () => {
    expect(
      sanitizeAuditChanges('boarding.board', { seat: 'A1' }, { seat: 'A1' }),
    ).toEqual({ before: null, after: null });
    expect(
      sanitizeAuditChanges('boarding.unboard', { x: 1 }, { y: 2 }),
    ).toEqual({ before: null, after: null });
  });

  it('strips accidental PII from reservation.created', () => {
    const { after } = sanitizeAuditChanges('reservation.created', null, {
      trip_id: 't1',
      passenger_count: 2,
      seat_codes: ['A1', 'A2'],
      ...PII_POLLUTION,
    });
    expect(after).toEqual({
      trip_id: 't1',
      passenger_count: 2,
      seat_codes: ['A1', 'A2'],
    });
    const serialized = JSON.stringify(after);
    for (const key of Object.keys(PII_POLLUTION)) {
      expect(serialized).not.toContain(key);
    }
  });

  it('allows branding keys only for agency_settings.updated', () => {
    const { after } = sanitizeAuditChanges('agency_settings.updated', null, {
      logo_url: 'https://cdn.example.com/a.png',
      primary_color: '#000024',
      secondary_color: '#0080FF',
      accent_color: '#00D4FF',
      agency_name: 'Hacked',
      ...PII_POLLUTION,
    });
    expect(after).toEqual({
      logo_url: 'https://cdn.example.com/a.png',
      primary_color: '#000024',
      secondary_color: '#0080FF',
      accent_color: '#00D4FF',
    });
  });

  it('allows notification channel email boolean; drops unknown categories', () => {
    const { after } = sanitizeAuditChanges(
      'notification_preferences.updated',
      null,
      {
        occupancy_alerts: { in_app: true, email: false, sms: true },
        unknown_category: { in_app: true, email: true },
        contact_email: 'leak@example.com',
      },
    );
    expect(after).toEqual({
      occupancy_alerts: { in_app: true, email: false },
    });
  });

  it('does not mutate the input object', () => {
    const input = {
      status: 'cancelled',
      email: 'secret@example.com',
    };
    const snapshot = { ...input };
    sanitizeAuditChanges('trip.cancelled', null, input);
    expect(input).toEqual(snapshot);
  });

  it('keeps reservation_link status/seat_codes and drops token/PII', () => {
    const { after } = sanitizeAuditChanges('reservation_link.created', null, {
      seat_codes: ['A1', 'A2'],
      trip_id: 'trip-1',
      token: 'raw-token',
      name: 'Juan',
      document: '123',
    });
    expect(after).toEqual({
      seat_codes: ['A1', 'A2'],
      trip_id: 'trip-1',
    });
  });
});

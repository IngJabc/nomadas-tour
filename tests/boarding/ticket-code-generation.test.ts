/**
 * @vitest-environment node
 *
 * AUD-020.11 — ticket_code generation on new reservations (regression).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function deriveTicketCodeFromUuid(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

describe('AUD-020.11 — ticket_code derivation contract', () => {
  it('produces exactly 8 uppercase hex chars from reservation UUID', () => {
    const id = '6bbd52e9-83ab-4954-93ea-ee20466c18a2';
    const ticket = deriveTicketCodeFromUuid(id);

    expect(ticket).toHaveLength(8);
    expect(ticket).toMatch(/^[A-F0-9]{8}$/);
    expect(ticket).toBe('6BBD52E9');
    expect(ticket).toBe(
      id.replace(/-/g, '').slice(0, 8).toUpperCase(),
    );
  });

  it('never derives ticket_code from qr_code payload', () => {
    const id = '6bbd52e9-83ab-4954-93ea-ee20466c18a2';
    const qr = 'NT-LA OLLA-6BBD52E983AB495493EAEE20466C18A2';
    const ticket = deriveTicketCodeFromUuid(id);

    expect(qr.startsWith('NT-')).toBe(true);
    expect(ticket).not.toContain('NT-');
    expect(ticket).toBe(id.replace(/-/g, '').slice(0, 8).toUpperCase());
  });
});

describe('AUD-020.11 — migration 047 static contract', () => {
  const migration = fs.readFileSync(
    path.join(
      REPO_ROOT,
      'supabase/migrations/047_update_create_agency_reservation_ticket_code.sql',
    ),
    'utf8',
  );

  it('replaces create_agency_reservation and inserts ticket_code', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.create_agency_reservation');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = public');
    expect(migration).toContain('v_ticket_code');
    expect(migration).toContain(
      "UPPER(LEFT(REPLACE(v_reservation_id::text, '-', ''), 8))",
    );
    expect(migration).toMatch(/INSERT INTO reservations \([\s\S]*ticket_code[\s\S]*\)/);
    expect(migration).toContain("'ticket_code', v_ticket_code");
  });

  it('keeps qr_code generation and reaffirms service_role grants', () => {
    expect(migration).toContain(
      "v_qr_code := 'NT-' || UPPER(COALESCE(v_destination, '')) || '-' || UPPER(REPLACE(v_reservation_id::TEXT, '-', ''))",
    );
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.create_agency_reservation');
    expect(migration).toContain('TO service_role');
    expect(migration).toContain('FROM anon');
    expect(migration).toContain('FROM authenticated');
  });

  it('does not alter boarding_toggle or ADR-001', () => {
    expect(migration).not.toContain('boarding_toggle');
    expect(migration).not.toContain('ADR-001');
  });
});

describe('AUD-020.11 — lookup still resolves by ticket_code', () => {
  it('boarding service finds reservations via exact ticket_code eq', () => {
    const service = fs.readFileSync(
      path.join(REPO_ROOT, 'backend/src/services/reservation.service.ts'),
      'utf8',
    );
    const start = service.indexOf('findReservationByExactCredential');
    const end = service.indexOf('async toggleBoarding');
    const block = service.slice(start, end);

    expect(block).toContain(".eq('ticket_code'");
    expect(block).toContain(".eq('qr_code'");
    expect(block).not.toMatch(/\.ilike\(/);
  });
});

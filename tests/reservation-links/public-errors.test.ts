import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PUBLIC_LINK_ERROR_COPY,
  formFromPublicBody,
  mergePassengersFromLinkData,
  publicLinkErrorCopy,
} from '@/lib/reservation-links';

describe('F5-004 public link error copy', () => {
  it('has distinct copy for every public error.code', () => {
    expect(PUBLIC_LINK_ERROR_COPY.LINK_NOT_FOUND).toBe('Este enlace no existe.');
    expect(PUBLIC_LINK_ERROR_COPY.LINK_EXPIRED).toBe('Este enlace ha expirado.');
    expect(PUBLIC_LINK_ERROR_COPY.TRIP_CHANGED).toBe(
      'Este viaje fue modificado. Solicita un nuevo enlace.',
    );
    expect(PUBLIC_LINK_ERROR_COPY.TRIP_MISSING).toBe('Este viaje ya no está disponible.');
    expect(PUBLIC_LINK_ERROR_COPY.LINK_CONFIRMED).toBe('Esta reserva ya fue confirmada.');
    expect(PUBLIC_LINK_ERROR_COPY.LINK_CANCELLED).toBe('Este enlace ya no es válido.');
    const values = Object.values(PUBLIC_LINK_ERROR_COPY);
    expect(new Set(values).size).toBe(values.length);
  });

  it('builds passengers from seats when link_data is empty', () => {
    const form = formFromPublicBody({
      trip: { destination: 'Punta', departure_time: '2026-01-01T08:00:00Z' },
      agency: { name: 'Central', logo_url: null },
      seats: ['A1', 'A2'],
      link_data: {},
      expires_at: '2026-01-01T12:15:00Z',
    });
    expect(form.passengers.map((p) => p.seat_code)).toEqual(['A1', 'A2']);
    expect(form.passengers.every((p) => p.name === '' && p.document === '')).toBe(true);
  });

  it('falls back when code is unknown', () => {
    expect(publicLinkErrorCopy('UNKNOWN', 'fallback')).toBe('fallback');
  });
});

describe('F5-004 wizard TTL 600', () => {
  it('defaults countdown and wizard env fallback to 600', () => {
    const root = join(process.cwd());
    const countdown = readFileSync(join(root, 'hooks/useLockCountdown.ts'), 'utf8');
    const wizard = readFileSync(join(root, 'app/agency/reservations/new/page.tsx'), 'utf8');
    expect(countdown).toContain('ttlSeconds = 600');
    expect(countdown).toContain('lock_expires_at');
    expect(wizard).toContain('NEXT_PUBLIC_LOCK_TTL_SECONDS || 600');
    expect(wizard).not.toContain('NEXT_PUBLIC_LOCK_TTL_SECONDS || 300');
    expect(wizard).not.toContain('/agency/reservations/links');
    expect(wizard).toContain('cambió la selección de asientos');
    expect(wizard).toContain('Cancelar enlace');
  });

  it('lists /reservations/link as a public path', () => {
    const mw = readFileSync(join(process.cwd(), 'middleware.ts'), 'utf8');
    expect(mw).toContain("'/reservations/link'");
  });
});

describe('F5-004 mergePassengersFromLinkData', () => {
  it('maps public save fields onto wizard passengers by seat_code', () => {
    const next = mergePassengersFromLinkData(
      [
        { seat_id: 'u1', seat_code: 'A1', name: '', document: '', phone: '' },
        { seat_id: 'u2', seat_code: 'A2', name: 'Old', document: '1', phone: '' },
      ],
      {
        booker_name: 'Ana',
        booker_document: '123',
        booker_phone: '',
        passengers: [
          { seat_code: 'A2', name: 'Luis', document: '45678901', phone: '099' },
        ],
      },
    );
    expect(next[0]).toEqual({ seat_id: 'u1', seat_code: 'A1', name: '', document: '', phone: '' });
    expect(next[1]).toEqual({
      seat_id: 'u2',
      seat_code: 'A2',
      name: 'Luis',
      document: '45678901',
      phone: '099',
    });
  });
});

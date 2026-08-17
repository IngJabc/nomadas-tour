/**
 * @vitest-environment node
 *
 * Wizard `/agency/reservations/new` — hide trips that already departed.
 * Backend 066 remains the source of truth; this only filters the selector.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { filterBookableTrips, isTripOpenForReservation } from '@/lib/reservations/bookableTrips';
import type { AgencyTripListItem } from '@/types';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const PAGE = 'app/agency/reservations/new/page.tsx';
const CARD = 'components/agency/AgencyTripCard.tsx';
const TRIPS_PAGE = 'app/agency/trips/AgencyTripsContent.tsx';

const NOW = new Date('2026-08-16T22:00:00.000Z');
const PAST = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
const FUTURE = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();
const AT_NOW = NOW.toISOString();

function trip(
  overrides: Partial<AgencyTripListItem> & { id: string },
): AgencyTripListItem {
  return {
    route: { origin: 'Caracas', destination: 'Mérida' },
    departure_time: FUTURE,
    vehicle_type: 'kia',
    status: 'active',
    total_seats: 10,
    available_seats: 4,
    reserved_seats: 0,
    ...overrides,
  };
}

describe('reservation wizard — bookable trip filter', () => {
  it('is used by /agency/reservations/new', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, PAGE), 'utf8');
    expect(src).toContain('filterBookableTrips');
    expect(src).toMatch(/const now = new Date\(\)/);
  });

  it('hides Nueva Reserva on /agency/trips cards when the trip is not bookable', () => {
    const card = fs.readFileSync(path.join(REPO_ROOT, CARD), 'utf8');
    const list = fs.readFileSync(path.join(REPO_ROOT, TRIPS_PAGE), 'utf8');
    expect(card).toContain('isTripOpenForReservation');
    expect(card).toContain('canCreateReservation');
    expect(card).toContain('Ya salió');
    expect(list).toContain('now={now}');
  });

  it('hides an active trip whose departure already passed', () => {
    const rows = [trip({ id: 'past', departure_time: PAST, available_seats: 4 })];
    expect(filterBookableTrips(rows, NOW).map((t) => t.id)).toEqual([]);
  });

  it('shows an active trip with seats and future departure', () => {
    const rows = [trip({ id: 'future', departure_time: FUTURE, available_seats: 4 })];
    expect(filterBookableTrips(rows, NOW).map((t) => t.id)).toEqual(['future']);
  });

  it('hides a trip whose departure_time is exactly now (not strictly future)', () => {
    const rows = [trip({ id: 'edge', departure_time: AT_NOW, available_seats: 4 })];
    expect(filterBookableTrips(rows, NOW).map((t) => t.id)).toEqual([]);
  });

  it('keeps cancelled/completed/archived and full trips excluded', () => {
    const rows = [
      trip({ id: 'ok', departure_time: FUTURE, available_seats: 2 }),
      trip({ id: 'cancelled', status: 'cancelled', departure_time: FUTURE }),
      trip({ id: 'completed', status: 'completed', departure_time: FUTURE }),
      trip({ id: 'archived', status: 'archived', departure_time: FUTURE }),
      trip({ id: 'full', available_seats: 0, departure_time: FUTURE }),
    ];
    expect(filterBookableTrips(rows, NOW).map((t) => t.id)).toEqual(['ok']);
  });

  it('isTripOpenForReservation is false for a departed active trip with seats', () => {
    expect(
      isTripOpenForReservation(
        trip({ id: 'past', departure_time: PAST, available_seats: 4 }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isTripOpenForReservation(
        trip({ id: 'future', departure_time: FUTURE, available_seats: 4 }),
        NOW,
      ),
    ).toBe(true);
  });
});

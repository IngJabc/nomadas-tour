import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboxEventRow } from '../../events/types.js';
import {
  RESERVATION_LINK_CREATED_V1_TYPE,
  RESERVATION_LINK_SAVED_V1_TYPE,
} from '../../events/reservation-link.v1.js';

const mockCreateForAgency = vi.fn(async () => undefined);
const mockMaybeSingle = vi.fn();

vi.mock('../../config/database.js', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => mockMaybeSingle(),
        }),
      }),
    }),
  },
}));

vi.mock('../../services/notification.service.js', () => ({
  notificationService: {
    createForAgency: (...args: unknown[]) => mockCreateForAgency(...args),
  },
}));

import {
  createReservationLinkAckHandler,
  createReservationLinkPassengerSavedHandler,
} from './reservation-link.handler.js';

const LINK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TRIP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AGENCY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function row(type: string): OutboxEventRow {
  return {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    event_type: type,
    event_version: 1,
    aggregate_type: 'reservation_link',
    aggregate_id: LINK_ID,
    tenant_id: AGENCY_ID,
    payload: { link_id: LINK_ID, trip_id: TRIP_ID, agency_id: AGENCY_ID },
    status: 'processing',
    attempts: 1,
    available_at: '2026-08-18T12:00:00.000Z',
    processed_at: null,
    error_message: null,
    created_at: '2026-08-18T12:00:00.000Z',
    updated_at: '2026-08-18T12:00:00.000Z',
  };
}

describe('F5-004 reservation-link handlers', () => {
  beforeEach(() => {
    mockCreateForAgency.mockClear();
    mockMaybeSingle.mockResolvedValue({
      data: { routes: { destination: 'Punta del Este' } },
      error: null,
    });
  });

  it('acks created without notifying', async () => {
    const outcome = await createReservationLinkAckHandler('created')(
      row(RESERVATION_LINK_CREATED_V1_TYPE),
    );
    expect(outcome).toEqual({ kind: 'completed', reason: 'delivered' });
    expect(mockCreateForAgency).not.toHaveBeenCalled();
  });

  it('notifies agency on first passenger_data_saved', async () => {
    const outcome = await createReservationLinkPassengerSavedHandler()(
      row(RESERVATION_LINK_SAVED_V1_TYPE),
    );
    expect(outcome).toEqual({ kind: 'completed', reason: 'delivered' });
    expect(mockCreateForAgency).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reservation_link_passenger_data',
        entityType: 'reservation_link',
        entityId: LINK_ID,
        agencyId: AGENCY_ID,
        actor: 'system',
        action_url: '/agency/trips',
      }),
    );
  });
});

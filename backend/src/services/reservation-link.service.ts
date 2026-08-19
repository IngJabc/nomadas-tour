import { supabaseAdmin } from '../config/database.js';
import { env } from '../config/env.js';
import { generateQRDataURL } from '../utils/qr.js';
import { generateToken, hashToken } from '../utils/token.js';
import { NotFoundError, ValidationError } from '../errors/index.js';
import {
  mapPublicLinkErrorCode,
  mapReservationLinkRpcError,
} from './reservation-link.errors.js';

const TOKEN_RE = /^[a-f0-9]{64}$/;

export interface LinkPassengerPayload {
  seat_code: string;
  name?: string;
  document?: string;
  phone?: string;
}

export interface LinkDataPayload {
  booker_name?: string;
  booker_document?: string;
  booker_phone?: string;
  passengers: LinkPassengerPayload[];
}

function rpcMessage(error: { message?: string } | null): string {
  return error?.message || 'RPC failed';
}

export class ReservationLinkService {
  async createLink(tripId: string, seatIds: string[], agencyId: string, userId: string) {
    const token = generateToken();
    const tokenHash = hashToken(token);

    const { data, error } = await supabaseAdmin.rpc('create_reservation_link', {
      p_trip_id: tripId,
      p_agency_id: agencyId,
      p_created_by: userId,
      p_token_hash: tokenHash,
      p_seat_ids: seatIds,
    });

    if (error) mapReservationLinkRpcError(rpcMessage(error));

    const row = data as { link_id: string; seat_codes: string[]; expires_at: string };
    const origin = env.FRONTEND_URL.replace(/\/$/, '');
    return {
      link_id: row.link_id,
      token,
      url: `${origin}/reservations/link?token=${token}`,
      expires_at: row.expires_at,
      seats: row.seat_codes,
    };
  }

  async confirm(linkId: string, agencyId: string, userId: string) {
    const { data, error } = await supabaseAdmin.rpc('confirm_reservation_from_link', {
      p_link_id: linkId,
      p_agency_id: agencyId,
      p_created_by: userId,
    });
    if (error) mapReservationLinkRpcError(rpcMessage(error));

    const result = data as { reservation_id: string; qr_code: string; ticket_code: string };
    const qrDataUrl = await generateQRDataURL(result.qr_code);
    return { ...result, qr_data_url: qrDataUrl };
  }

  async cancel(linkId: string, agencyId: string) {
    const { error } = await supabaseAdmin.rpc('cancel_reservation_link', {
      p_link_id: linkId,
      p_agency_id: agencyId,
    });
    if (error) mapReservationLinkRpcError(rpcMessage(error));
    return { success: true };
  }

  async invalidate(linkId: string, agencyId: string) {
    const { error } = await supabaseAdmin.rpc('invalidate_reservation_link', {
      p_link_id: linkId,
      p_agency_id: agencyId,
    });
    if (error) mapReservationLinkRpcError(rpcMessage(error));
    return { success: true };
  }

  async regenerate(linkId: string, agencyId: string, userId: string) {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const { data, error } = await supabaseAdmin.rpc('regenerate_reservation_link', {
      p_old_link_id: linkId,
      p_agency_id: agencyId,
      p_created_by: userId,
      p_token_hash: tokenHash,
    });
    if (error) mapReservationLinkRpcError(rpcMessage(error));
    const row = data as {
      link_id: string;
      seat_codes: string[];
      expires_at: string;
      inherited_data: LinkDataPayload;
    };
    const origin = env.FRONTEND_URL.replace(/\/$/, '');
    return {
      link_id: row.link_id,
      token,
      url: `${origin}/reservations/link?token=${token}`,
      expires_at: row.expires_at,
      seats: row.seat_codes,
      inherited_data: row.inherited_data,
    };
  }

  async patchData(linkId: string, agencyId: string, linkData: LinkDataPayload) {
    const { data, error } = await supabaseAdmin.rpc('patch_reservation_link_data', {
      p_link_id: linkId,
      p_agency_id: agencyId,
      p_link_data: linkData,
    });
    if (error) mapReservationLinkRpcError(rpcMessage(error));
    return data;
  }

  async list(agencyId: string, filters: { trip_id?: string; status?: string }) {
    await supabaseAdmin.rpc('reservation_link_materialize_agency', {
      p_agency_id: agencyId,
    });

    let query = supabaseAdmin
      .from('reservation_links')
      .select('id, trip_id, status, expires_at, link_data, created_at, reservation_link_seats(seat_code)')
      .eq('agency_id', agencyId)
      .order('created_at', { ascending: false });

    if (filters.trip_id) query = query.eq('trip_id', filters.trip_id);
    if (filters.status) query = query.eq('status', filters.status);

    const { data, error } = await query;
    if (error) throw new ValidationError(error.message);

    const tripIds = [...new Set((data || []).map((row: { trip_id: string }) => row.trip_id))];
    const tripsById = new Map<string, { destination: string; departure_time: string }>();
    if (tripIds.length > 0) {
      const { data: trips } = await supabaseAdmin
        .from('trips')
        .select('id, departure_time, routes!inner(destination)')
        .in('id', tripIds);
      for (const t of trips || []) {
        tripsById.set(t.id, {
          destination: (t as { routes?: { destination?: string } }).routes?.destination || '',
          departure_time: t.departure_time,
        });
      }
    }

    return (data || []).map((row: Record<string, unknown>) => {
      const seats = ((row.reservation_link_seats as { seat_code: string }[]) || [])
        .map((s) => s.seat_code)
        .sort();
      const linkData = (row.link_data || {}) as LinkDataPayload;
      const passengers = linkData.passengers || [];
      const complete = passengers.filter(
        (p) => (p.name || '').trim() && (p.document || '').trim(),
      ).length;
      const trip = tripsById.get(row.trip_id as string);
      return {
        id: row.id,
        trip_id: row.trip_id,
        status: row.status,
        expires_at: row.expires_at,
        seats,
        passenger_data_complete: complete,
        passenger_total: seats.length,
        destination: trip?.destination ?? null,
        departure_time: trip?.departure_time ?? null,
      };
    });
  }

  async getById(linkId: string, agencyId: string) {
    await supabaseAdmin.rpc('reservation_link_materialize_agency', {
      p_agency_id: agencyId,
    });

    const { data, error } = await supabaseAdmin
      .from('reservation_links')
      .select('id, trip_id, status, expires_at, link_data, created_at, reservation_link_seats(seat_code)')
      .eq('id', linkId)
      .eq('agency_id', agencyId)
      .maybeSingle();

    if (error) throw new ValidationError(error.message);
    if (!data) throw new NotFoundError('Link not found');

    const seats = ((data.reservation_link_seats as { seat_code: string }[]) || [])
      .map((s) => s.seat_code)
      .sort();
    return {
      id: data.id,
      trip_id: data.trip_id,
      status: data.status,
      expires_at: data.expires_at,
      link_data: data.link_data,
      seats,
      created_at: data.created_at,
    };
  }

  async publicGet(token: string) {
    if (!TOKEN_RE.test(token)) mapPublicLinkErrorCode('LINK_NOT_FOUND');
    const { data, error } = await supabaseAdmin.rpc('public_get_reservation_link', {
      p_token_hash: hashToken(token),
    });
    if (error) mapReservationLinkRpcError(rpcMessage(error));
    const payload = data as { ok: boolean; error_code: string | null; body: unknown };
    if (!payload.ok) mapPublicLinkErrorCode(payload.error_code || 'LINK_NOT_FOUND');
    return payload.body;
  }

  async publicSave(token: string, linkData: LinkDataPayload) {
    if (!TOKEN_RE.test(token)) mapPublicLinkErrorCode('LINK_NOT_FOUND');
    const { data, error } = await supabaseAdmin.rpc('public_save_reservation_link', {
      p_token_hash: hashToken(token),
      p_link_data: linkData,
    });
    if (error) mapReservationLinkRpcError(rpcMessage(error));
    const payload = data as { ok: boolean; error_code: string | null; body: unknown };
    if (!payload.ok) mapPublicLinkErrorCode(payload.error_code || 'LINK_NOT_FOUND');
    return payload.body;
  }
}

export const reservationLinkService = new ReservationLinkService();

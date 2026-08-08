import type { AgencyReservation, AgencyTripPassengersResponse } from '@/types';
import type { AppUser } from '@/lib/auth/types';
import { ApiError } from '@/lib/errors/api-error';
import { logoutInactiveAgency } from '@/lib/auth/session-handler';

export interface NotificationPreferenceCategory {
  key: string;
  label: string;
  description: string;
  locked: boolean;
  channels: {
    in_app: boolean;
    email: boolean;
  };
}

export interface NotificationPreferencesResponse {
  preferences: {
    trip_assignments: boolean;
    trip_schedule_changes: boolean;
    trip_status_updates: boolean;
    trip_cancellations: boolean;
  };
  categories: NotificationPreferenceCategory[];
}

export interface AgencyBrandingSettings {
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
}

export type AgencyBrandingPatch = Partial<AgencyBrandingSettings>;

/** Minimal boarding lookup DTO (AUD-020). No documents, phones, or QR. */
export interface BoardingLookupPassenger {
  id: string;
  name: string;
  seat_code: string | null;
  boarded: boolean;
  boarded_at: string | null;
}

export interface BoardingLookupDTO {
  trip: {
    id: string;
    status: string;
    departure_time: string;
    route: {
      origin: string;
      destination: string;
    };
  };
  reservation_status: string;
  reservation_agency_name: string;
  passengers: BoardingLookupPassenger[];
}

export type BoardingLookupFailureCode =
  | 'EMPTY_INPUT'
  | 'CREDENTIAL_NOT_FOUND'
  | 'AGENCY_NOT_ASSIGNED'
  | 'TRIP_NOT_DEPARTED'
  | 'TRIP_INVALID'
  | 'TRIP_NOT_FOUND'
  | 'RESERVATION_CANCELLED';

/** Single-result boarding lookup envelope (exact credential). */
export interface BoardingLookupResponse {
  found: boolean;
  allowed: boolean;
  failure_code: BoardingLookupFailureCode | null;
  result: BoardingLookupDTO | null;
}

export interface BoardingToggleResult {
  passenger_id: string;
  boarded: boolean;
  boarded_at: string | null;
  changed: boolean;
  reservation_status: string;
  boarded_count: number;
  total_count: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

interface RequestOptions extends RequestInit {
  params?: Record<string, string | undefined>;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { params, ...fetchOptions } = options;

  let url = `${API_BASE}${path}`;
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val) searchParams.set(key, val);
    });
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };

  // Include auth token from Supabase session if available
  try {
    const { createClient } = await import('./supabase/client');
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
  } catch {
    // Ignore if running server-side without window
  }

  const res = await fetch(url, { ...fetchOptions, headers });

  if (res.status === 204) {
    return undefined as T;
  }

  const data = await res.json();

  if (!res.ok) {
    const errorObj = data?.error;
    const code = errorObj?.code;
    const message = errorObj?.message || data?.error || 'API request failed';

    if (code === 'AGENCY_INACTIVE' && !path.startsWith('/auth/login')) {
      logoutInactiveAgency();
    }

    throw new ApiError(message, code || 'UNKNOWN', res.status);
  }

  return data;
}

export async function requestForm<T>(
  path: string,
  formData: FormData,
  options: Omit<RequestInit, 'body'> = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  try {
    const { createClient } = await import('./supabase/client');
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }
  } catch {
    // Ignore if running server-side without window.
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    body: formData,
    headers,
  });
  const data = res.status === 204 ? undefined : await res.json();

  if (!res.ok) {
    const errorObj = data?.error;
    const code = errorObj?.code;
    const message = errorObj?.message || data?.error || 'API request failed';

    if (code === 'AGENCY_INACTIVE' && !path.startsWith('/auth/login')) {
      logoutInactiveAgency();
    }

    throw new ApiError(message, code || 'UNKNOWN', res.status);
  }

  return data as T;
}

// Auth
export const authApi = {
  login: (email: string, password: string) =>
    request<{ token: string; refresh_token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  validateInvitation: (token: string) =>
    request<{ agency_name: string; email: string }>('/auth/validate-invitation', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  acceptInvitation: (token: string, password: string) =>
    request<{ token: string; user: any }>('/auth/accept-invitation', {
      method: 'POST',
      body: JSON.stringify({ token, password, confirm_password: password }),
    }),
  forgotPassword: (email: string) =>
    request<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (identifier: { token?: string; code?: string }, password: string) =>
    request<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ ...identifier, password, confirm_password: password }),
    }),
  me: () => request<{ user: AppUser }>('/auth/me'),
};

// Superadmin
export const adminApi = {
  getDashboard: () => request<any>('/admin/dashboard'),
  listAgencies: () => request<any[]>('/admin/agencies'),
  getAgency: (id: string) => request<any>(`/admin/agencies/${id}`),
  createAgency: (data: { name: string; email: string }) =>
    request<any>('/admin/agencies', { method: 'POST', body: JSON.stringify(data) }),
  updateAgency: (id: string, data: { name?: string; status?: string }) =>
    request<any>(`/admin/agencies/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  listRoutes: () => request<any[]>('/admin/routes'),
  createRoute: (data: { origin: string; destination: string }) =>
    request<any>('/admin/routes', { method: 'POST', body: JSON.stringify(data) }),
  updateRoute: (id: string, data: { origin?: string; destination?: string }) =>
    request<any>(`/admin/routes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deactivateRoute: (id: string) =>
    request<void>(`/admin/routes/${id}/deactivate`, { method: 'PATCH' }),
  activateRoute: (id: string) =>
    request<void>(`/admin/routes/${id}/activate`, { method: 'PATCH' }),
  listTrips: (params?: { page?: number; limit?: number }) =>
    request<any>('/admin/trips', { params: params as any }),
  getTrip: (id: string) => request<any>(`/admin/trips/${id}`),
  createTrip: (data: {
    route_id: string;
    departure_time: string;
    vehicle_type: 'bus' | 'kia';
    agency_ids: string[];
  }) => request<any>('/admin/trips', { method: 'POST', body: JSON.stringify(data) }),
  updateTrip: (id: string, data: {
    route_id: string;
    departure_time: string;
    vehicle_type: 'bus' | 'kia';
    agency_ids: string[];
    postpone?: boolean;
  }) => request<{
    trip: Record<string, unknown>;
    action: 'POSTPONED' | 'UPDATED';
  }>(`/admin/trips/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  addTripAgencies: (tripId: string, agency_ids: string[]) =>
    request<{
      added_agency_ids: string[];
      trip_agencies: { agency_id: string; agency_name: string }[];
    }>(`/admin/trips/${tripId}/agencies`, {
      method: 'POST',
      body: JSON.stringify({ agency_ids }),
    }),
  archiveTrip: (id: string) =>
    request<{ id: string; status: 'archived' }>(`/admin/trips/${id}/archive`, {
      method: 'PATCH',
    }),
  updateTripStatus: (id: string, status: string) =>
    request<any>(`/admin/trips/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  getPassengerTree: (params?: { status?: string; route_id?: string; trip_id?: string; agency_id?: string; date?: string; search?: string }) =>
    request<any>('/admin/reservations/tree', { params: params as any }),
  getReservation: (id: string) => request<any>(`/admin/reservations/${id}`),
  updateReservationStatus: (id: string, status: string) =>
    request<any>(`/admin/reservations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
};

// Agency
export const agencyApi = {
  getBranding: () =>
    request<AgencyBrandingSettings>('/agency/settings/branding'),
  updateBranding: (patch: AgencyBrandingPatch) =>
    request<AgencyBrandingSettings>('/agency/settings/branding', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  uploadLogo: (file: File) => {
    const formData = new FormData();
    formData.append('logo', file);
    return requestForm<AgencyBrandingSettings>(
      '/agency/settings/logo',
      formData,
      { method: 'POST' },
    );
  },
  getDashboard: () => request<any>('/agency/dashboard'),
  listTrips: () => request<any[]>('/agency/trips'),
  getTrips: () => request<any[]>('/agency/trips'),
  getTrip: (tripId: string) => request<any>(`/agency/trips/${tripId}`),
  getTripPassengers: (tripId: string) =>
    request<AgencyTripPassengersResponse>(`/agency/trips/${tripId}/passengers`),
  listReservations: () => request<AgencyReservation[]>('/agency/reservations'),
  createReservation: (data: {
    trip_id: string;
    booker_name: string;
    booker_document: string;
    booker_phone?: string;
    contact_email?: string;
    send_ticket_email?: boolean;
    passengers: { seat_id: string; name: string; document: string; phone?: string }[];
  }) =>
    request<{
      reservation: any;
      passengers: any[];
      qr_code: string;
      qr_data_url: string;
    }>('/agency/reservations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getReservation: (id: string) => request<any>(`/agency/reservations/${id}`),
  cancelAgencyReservation: (id: string) =>
    request<any>(`/agency/reservations/${id}/cancel`, { method: 'PATCH' }),
  cancelPassenger: (reservationId: string, passengerId: string) =>
    request<any>(`/agency/reservations/${reservationId}/passengers/${passengerId}/cancel`, { method: 'PATCH' }),
  lockSeat: (trip_id: string, seat_id: string) =>
    request<{ locked: boolean; seat_id: string; locked_at: string }>('/agency/seats/lock', {
      method: 'POST',
      body: JSON.stringify({ trip_id, seat_id }),
    }),
  unlockSeat: (trip_id: string, seat_id: string) =>
    request<{ unlocked: boolean; seat_id: string }>('/agency/seats/unlock', {
      method: 'POST',
      body: JSON.stringify({ trip_id, seat_id }),
    }),
  unlockAllSeats: (trip_id: string) =>
    request<{ unlocked: number }>('/agency/seats/unlock-all', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    }),
  unlockAllUserSeats: () =>
    request<{ unlocked: number }>('/agency/seats/unlock-all-user', {
      method: 'POST',
    }),

  // Boarding — exact ticket_code / full QR lookup + RPC toggle
  lookupPassengerByQR: (credential: string) =>
    request<BoardingLookupResponse>(
      `/agency/boarding/${encodeURIComponent(credential)}`,
    ),

  toggleBoarding: (passengerId: string, boarded: boolean) =>
    request<BoardingToggleResult>(`/agency/boarding/${passengerId}`, {
      method: 'PATCH',
      body: JSON.stringify({ boarded }),
    }),

  getNotificationPreferences: () =>
    request<NotificationPreferencesResponse>('/agency/notification-preferences'),

  updateNotificationPreferences: (
    patch: Partial<NotificationPreferencesResponse['preferences']>,
  ) =>
    request<NotificationPreferencesResponse>('/agency/notification-preferences', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
};

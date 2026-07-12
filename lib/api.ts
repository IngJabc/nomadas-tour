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
    throw new Error(data?.error?.message || data?.error || 'API request failed');
  }

  return data;
}

// Auth
export const authApi = {
  login: (email: string, password: string) =>
    request<{ token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string, full_name: string) =>
    request<{ token: string; user: any }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, full_name }),
    }),
  registerAgency: (data: { email: string; password: string; agency_name: string }) =>
    request<{ token: string; user: any; agency: any }>('/auth/register-agency', {
      method: 'POST',
      body: JSON.stringify(data),
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
};

// Customer (public)
export const customerApi = {
  listTrips: () => request<any[]>('/trips'),
  getTripWithSeats: (tripId: string) =>
    request<any>(`/trips/${tripId}`),
  getAvailableAgencies: (tripId: string) =>
    request<any[]>(`/trips/${tripId}/agencies`),
  getMyReservations: () => request<any[]>('/reservations/my'),
  createReservation: (data: {
    trip_id: string;
    customer_name: string;
    passenger_cedula: string;
    phone?: string;
    seat_codes: string[];
  }) =>
    request<{
      transaction_id: string;
      qr_code: string;
      qr_data_url: string;
      reservations: any[];
      total: number;
    }>('/reservations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
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
  deleteRoute: (id: string) =>
    request<void>(`/admin/routes/${id}`, { method: 'DELETE' }),
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
  }) => request<any>(`/admin/trips/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTrip: (id: string) => request<void>(`/admin/trips/${id}`, { method: 'DELETE' }),
  updateTripStatus: (id: string, status: string) =>
    request<any>(`/admin/trips/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  listReservations: (filters?: { agency_id?: string; trip_id?: string; status?: string }) =>
    request<any[]>('/admin/reservations', { params: filters as any }),
  createInvitation: () =>
    request<any>('/admin/invitations', { method: 'POST' }),
  listInvitations: () =>
    request<any[]>('/admin/invitations'),
};

// Agency
export const agencyApi = {
  getDashboard: () => request<any>('/agency/dashboard'),
  listTrips: () => request<any[]>('/agency/trips'),
  getTrips: () => request<any[]>('/agency/trips'),
  getTrip: (tripId: string) => request<any>(`/agency/trips/${tripId}`),
  listReservations: () => request<any[]>('/agency/reservations'),
  createReservation: (data: {
    trip_id: string;
    booker_name: string;
    booker_document: string;
    booker_phone?: string;
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
  boardPassenger: (trip_id: string, qr_code: string) =>
    request<any>('/agency/reservations/board', {
      method: 'POST',
      body: JSON.stringify({ trip_id, qr_code }),
    }),
  cancelReservation: (trip_id: string, transaction_id: string) =>
    request<any>('/agency/reservations/cancel', {
      method: 'POST',
      body: JSON.stringify({ trip_id, transaction_id }),
    }),
  getReservation: (id: string) => request<any>(`/agency/reservations/${id}`),
  cancelAgencyReservation: (id: string) =>
    request<any>(`/agency/reservations/${id}/cancel`, { method: 'PATCH' }),
  lockSeat: (trip_id: string, seat_id: string) =>
    request<{ locked: boolean; seat_id: string }>('/agency/seats/lock', {
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

  // Sprint 13 — Boarding por pasajero individual
  lookupPassengerByQR: (qrCode: string) =>
    request<any>(`/agency/boarding/${encodeURIComponent(qrCode)}`),

  toggleBoarding: (passengerId: string, boarded: boolean) =>
    request<any>(`/agency/boarding/${passengerId}`, {
      method: 'PATCH',
      body: JSON.stringify({ boarded }),
    }),
};

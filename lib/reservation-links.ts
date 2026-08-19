export const PUBLIC_LINK_ERROR_COPY: Record<string, string> = {
  LINK_NOT_FOUND: 'Este enlace no existe.',
  LINK_EXPIRED: 'Este enlace ha expirado.',
  TRIP_CHANGED: 'Este viaje fue modificado. Solicita un nuevo enlace.',
  TRIP_MISSING: 'Este viaje ya no está disponible.',
  LINK_CONFIRMED: 'Esta reserva ya fue confirmada.',
  LINK_CANCELLED: 'Este enlace ya no es válido.',
};

export type PublicLinkErrorCode = keyof typeof PUBLIC_LINK_ERROR_COPY;

export interface LinkPassengerForm {
  seat_code: string;
  name: string;
  document: string;
  phone: string;
}

export interface LinkDataForm {
  booker_name: string;
  booker_document: string;
  booker_phone: string;
  passengers: LinkPassengerForm[];
}

export interface PublicReservationLinkBody {
  trip: { destination: string; departure_time: string };
  agency: {
    name: string;
    logo_url: string | null;
    primary_color: string | null;
    secondary_color: string | null;
    accent_color: string | null;
  };
  seats: string[];
  link_data: Partial<LinkDataForm> | Record<string, never>;
  expires_at: string;
}

export interface AgencyReservationLinkListItem {
  id: string;
  trip_id: string;
  status: 'active' | 'expired' | 'confirmed' | 'cancelled';
  expires_at: string;
  seats: string[];
  passenger_data_complete: number;
  passenger_total: number;
  destination: string | null;
  departure_time: string | null;
}

export interface AgencyReservationLinkDetail {
  id: string;
  trip_id: string;
  status: 'active' | 'expired' | 'confirmed' | 'cancelled';
  expires_at: string;
  link_data: LinkDataForm | Record<string, never>;
  seats: string[];
  created_at: string;
}

export interface CreateReservationLinkResult {
  link_id: string;
  token: string;
  url: string;
  expires_at: string;
  seats: string[];
}

export interface RegenerateReservationLinkResult extends CreateReservationLinkResult {
  inherited_data: LinkDataForm | Record<string, never>;
}

const URL_STORAGE_PREFIX = 'nt.reservation_link.url.';

export function rememberLinkUrl(linkId: string, url: string): void {
  try {
    sessionStorage.setItem(`${URL_STORAGE_PREFIX}${linkId}`, url);
  } catch {
    /* private mode */
  }
}

export function recallLinkUrl(linkId: string): string | null {
  try {
    return sessionStorage.getItem(`${URL_STORAGE_PREFIX}${linkId}`);
  } catch {
    return null;
  }
}

// ─── Active link persistence (survives remount) ───────────────

const ACTIVE_LINK_PREFIX = 'nt.active_link.';

export interface StoredActiveLink {
  linkId: string;
  url: string;
  tripId: string;
  seatCodes: string[];
}

export function rememberActiveLink(data: StoredActiveLink): void {
  try {
    sessionStorage.setItem(
      `${ACTIVE_LINK_PREFIX}${data.tripId}`,
      JSON.stringify(data),
    );
  } catch {
    /* private mode */
  }
}

export function recallActiveLink(tripId: string): StoredActiveLink | null {
  try {
    const raw = sessionStorage.getItem(`${ACTIVE_LINK_PREFIX}${tripId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredActiveLink;
    if (parsed.tripId !== tripId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearActiveLinkMemory(tripId: string): void {
  try {
    sessionStorage.removeItem(`${ACTIVE_LINK_PREFIX}${tripId}`);
  } catch {
    /* private mode */
  }
}

export function publicLinkErrorCopy(code: string | undefined, fallback: string): string {
  if (code && code in PUBLIC_LINK_ERROR_COPY) {
    return PUBLIC_LINK_ERROR_COPY[code];
  }
  return fallback;
}

export function emptyPassenger(seatCode: string): LinkPassengerForm {
  return { seat_code: seatCode, name: '', document: '', phone: '' };
}

export function formFromPublicBody(body: PublicReservationLinkBody): LinkDataForm {
  const incoming = (body.link_data || {}) as Partial<LinkDataForm>;
  const byCode = new Map(
    (incoming.passengers || []).map((p) => [p.seat_code, p]),
  );
  return {
    booker_name: incoming.booker_name || '',
    booker_document: incoming.booker_document || '',
    booker_phone: incoming.booker_phone || '',
    passengers: body.seats.map((code) => {
      const row = byCode.get(code);
      return {
        seat_code: code,
        name: row?.name || '',
        document: row?.document || '',
        phone: row?.phone || '',
      };
    }),
  };
}

export function formFromAgencyDetail(detail: AgencyReservationLinkDetail): LinkDataForm {
  return formFromPublicBody({
    trip: { destination: '', departure_time: '' },
    agency: { name: '', logo_url: null, primary_color: null, secondary_color: null, accent_color: null },
    seats: detail.seats,
    link_data: detail.link_data,
    expires_at: detail.expires_at,
  });
}

export function completedPassengerCount(form: LinkDataForm): number {
  return form.passengers.filter((p) => p.name.trim() && p.document.trim()).length;
}

export function formatCountdown(remainingSeconds: number): string {
  const safe = Math.max(0, remainingSeconds);
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

const DOCUMENT_RE = /^\d{7,8}$/;
const PHONE_STRIP_RE = /[\s\-]/g;

function isValidPhone(phone: string): boolean {
  const stripped = phone.replace(PHONE_STRIP_RE, '');
  if (/^\d{11}$/.test(stripped)) return true;
  if (/^\+\d{12}$/.test(stripped)) return true;
  return false;
}

export interface PublicLinkValidationErrors {
  booker_name?: string;
  booker_document?: string;
  booker_phone?: string;
  passengers: Record<string, { name?: string; document?: string; phone?: string }>;
}

export function validatePublicLinkDraft(form: LinkDataForm): PublicLinkValidationErrors {
  const errors: PublicLinkValidationErrors = { passengers: {} };

  if (form.booker_name.trim()) {
    if (form.booker_name.trim().length < 2) {
      errors.booker_name = 'Mínimo 2 caracteres';
    }
  }

  if (form.booker_document.trim()) {
    if (!DOCUMENT_RE.test(form.booker_document.trim())) {
      errors.booker_document = 'Debe tener 7 u 8 dígitos';
    }
  }

  if (form.booker_phone.trim()) {
    if (!isValidPhone(form.booker_phone.trim())) {
      errors.booker_phone = 'Formato: 0424xxxxxxx o +58424xxxxxxx';
    }
  }

  for (const p of form.passengers) {
    const pErrors: { name?: string; document?: string; phone?: string } = {};

    if (p.name.trim()) {
      if (p.name.trim().length < 2) {
        pErrors.name = 'Mínimo 2 caracteres';
      }
    }

    if (p.document.trim()) {
      if (!DOCUMENT_RE.test(p.document.trim())) {
        pErrors.document = 'Debe tener 7 u 8 dígitos';
      }
    }

    if (p.phone.trim()) {
      if (!isValidPhone(p.phone.trim())) {
        pErrors.phone = 'Formato: 0424xxxxxxx o +58424xxxxxxx';
      }
    }

    if (pErrors.name || pErrors.document || pErrors.phone) {
      errors.passengers[p.seat_code] = pErrors;
    }
  }

  return errors;
}

export function hasPublicLinkValidationErrors(errors: PublicLinkValidationErrors): boolean {
  if (errors.booker_name || errors.booker_document || errors.booker_phone) return true;
  return Object.keys(errors.passengers).length > 0;
}

export function mergePassengersFromLinkData<
  T extends { seat_code: string; name: string; document: string; phone: string },
>(passengers: T[], linkData: Partial<LinkDataForm> | undefined): T[] {
  const list = linkData?.passengers;
  if (!Array.isArray(list) || list.length === 0) return passengers;
  const byCode = new Map(list.map((p) => [p.seat_code, p]));
  return passengers.map((p) => {
    const row = byCode.get(p.seat_code);
    if (!row) return p;
    return {
      ...p,
      name: row.name ?? '',
      document: row.document ?? '',
      phone: row.phone ?? '',
    };
  });
}

// ─── MKT-008 · Contactos públicos de agencia ─────────────────────────────────
//
// Tipos, etiquetas y utilidades de teléfono para los contactos que la
// agencia administra desde su panel. Regla de teléfono ALINEADA con el
// resto del sistema (isValidPhone de lib/reservations/validateForm.ts y
// de lib/reservation-links.ts) y con las 4 capas de esta feature:
//   - CHECK de la migración 091: phone ~ '^([0-9]{11}|\+[0-9]{12})$'
//   - agency_contact_normalize_phone (091)
//   - Zod phoneSchema del backend (agency-contact.controller.ts)
//   - filterPhoneInput de este archivo (el input no admite letras)
// Si se cambia la expresión, cambiarla en los cuatro lugares.
// NO convertir 0… a 58… (el formato nacional se acepta tal cual).

export type AgencyContactChannel = 'call' | 'whatsapp';

export interface AgencyContact {
  id: string;
  agency_id: string;
  label: string;
  phone: string;
  channel: AgencyContactChannel;
  is_active: boolean;
  is_public: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateAgencyContactInput {
  label: string;
  phone: string;
  channel: AgencyContactChannel;
  is_public?: boolean;
  sort_order?: number;
}

export interface UpdateAgencyContactInput {
  label?: string;
  phone?: string;
  channel?: AgencyContactChannel;
  is_public?: boolean;
  sort_order?: number;
  is_active?: boolean;
}

export const CONTACT_CHANNEL_LABELS: Record<AgencyContactChannel, string> = {
  call: 'Llamada',
  whatsapp: 'WhatsApp',
};

/**
 * Formato del resto del sistema (espejo de isValidPhone en
 * lib/reservations/validateForm.ts y lib/reservation-links.ts):
 * 11 dígitos nacionales (0424xxxxxxx) o «+» con 12 dígitos
 * (+58424xxxxxxx). No admite letras.
 */
export const PHONE_PATTERN = /^(?:\d{11}|\+\d{12})$/;

/** Mensaje de validación idéntico al del resto del sistema. */
export const PHONE_FORMAT_MESSAGE = 'Formato: 0424xxxxxxx o +58424xxxxxxx';

/** Longitud máxima válida de entrada: «+» y 12 dígitos. */
export const PHONE_MAX_LENGTH = 13;

/**
 * Normaliza una entrada al formato almacenable: quita separadores de
 * presentación con la misma expresión que PHONE_STRIP_RE del sistema
 * (espacios y guiones). NO convierte 0… a 58… ni 00 a +.
 */
export function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-]/g, '');
}

/** Valida que una entrada sea del formato del sistema tras normalizar. */
export function isValidPhone(raw: string): boolean {
  return PHONE_PATTERN.test(normalizePhone(raw));
}

/**
 * Filtro para el input: deja solo dígitos y un «+» inicial (espejo de
 * filterPassengerPhone en lib/reservations/passengerFieldFilters.ts),
 * de modo que no se pueden escribir letras. Límites: «+» y 12 dígitos,
 * o 13 caracteres sin «+» (mismo toque que maxLength de pasajeros).
 */
export function filterPhoneInput(value: string): string {
  const clean = value.replace(/[^\d+]/g, '');
  const plusIndex = clean.indexOf('+');
  if (plusIndex > 0) return '+' + clean.replace(/\+/g, '').slice(0, 12);
  return clean.replace(/(?<=.)\+/g, '').slice(0, 13);
}

/**
 * Filtro para el nombre del contacto: quita caracteres de control
 * (imposibles de pegar limpios) y aplica el tope de 60 caracteres del
 * contrato del backend sin depender de maxLength del navegador.
 */
export function filterContactLabel(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 60);
}

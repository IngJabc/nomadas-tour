/**
 * Fase 2 — Tipos del frontend para administración de pagos de agencia.
 * Espejo de los DTOs de backend en backend/src/services/payment.service.ts.
 */

export type AgencyPaymentStatusFilter = 'pending' | 'verified' | 'rejected';

export type AgencyPaymentStatus = string;

/**
 * MKT-010.1 — etapa del pago dentro del plan de dos partes.
 * `full` = pago único (legado o plan single); `deposit` = primera
 * parte; `balance` = saldo restante.
 */
export type AgencyPaymentStage = 'full' | 'deposit' | 'balance';

/** Filtro de lista por etapa (`''` / ausente = todas). */
export type AgencyPaymentStageFilter = AgencyPaymentStage | '';

export interface AgencyPaymentListItem {
  id: string;
  status: string;
  /** MKT-010.1 — etapa del pago (`full` por defecto). */
  stage: AgencyPaymentStage;
  amount_cents: number;
  currency: string;
  submitted_at: string;
  verified_at: string | null;
  rejection_reason: string | null;
  has_proof: boolean;
  /** Intento de compra (MKT-007) que originó este pago, si lo hay. */
  checkout_attempt_id: string | null;
  reservation: {
    id: string;
    booker_name: string;
    contact_email: string | null;
    status: string;
    payment_status: string | null;
    trip: {
      id: string;
      departure_time: string;
      origin: string;
      destination: string;
    } | null;
  };
}

export interface ListAgencyPaymentsResult {
  payments: AgencyPaymentListItem[];
  page: number;
  limit: number;
  total: number;
}

export interface AgencyPaymentPassenger {
  id: string;
  seat_code: string | null;
  name: string;
  unit_price: number | null;
  status: string;
}

export interface AgencyPaymentAllocation {
  id: string;
  reservation_passenger_id: string;
  seat_code: string | null;
  amount_cents: number;
  created_at: string;
}

/**
 * MKT-010.1 — un pago de la reserva con su etapa, tal y como lo devuelve
 * la RPC `reservation_payment_progress` (solo reservas marketplace).
 */
export interface AgencyPaymentProgressPayment {
  id: string;
  stage: AgencyPaymentStage;
  status: string;
  amount_cents: number;
  currency: string;
  external_reference: string | null;
  bank_origin: string | null;
  payment_datetime: string | null;
  submitted_at: string;
  verified_at: string | null;
  rejection_reason: string | null;
}

/**
 * MKT-010.1 — progreso de pago de la reserva (total, depósito, pagado,
 * saldo, porcentajes server-side, vencimientos en vivo e info de
 * WhatsApp de la agencia).
 *
 * `deposit_overdue` / `balance_overdue` son SOLO informativos: nunca
 * cancelan ni liberan asientos (`seats_held` indica que siguen
 * reservados). `plan === 'two_stage'` ⇔ existe un depósito verificado.
 */
export interface AgencyPaymentProgress {
  reservation_id: string;
  reservation_status: string;
  payment_status: string | null;
  plan: 'single' | 'two_stage';
  passenger_count: number;
  total_cents: number;
  deposit_cents: number | null;
  deposit_verified_at: string | null;
  paid_cents: number;
  balance_cents: number;
  deposit_pct: number | null;
  balance_pct: number | null;
  deposit_deadline: string | null;
  balance_deadline: string | null;
  deposit_overdue: boolean;
  balance_overdue: boolean;
  seats_held: boolean;
  payments: AgencyPaymentProgressPayment[];
  agency: {
    id: string;
    name: string | null;
    whatsapp_phone: string | null;
  } | null;
}

export interface AgencyPaymentDetail {
  payment: {
    id: string;
    status: AgencyPaymentStatus;
    /** MKT-010.1 — etapa del pago (`full` por defecto). */
    stage: AgencyPaymentStage;
    amount_cents: number;
    currency: string;
    submitted_at: string;
    verified_at: string | null;
    verified_by: string | null;
    rejection_reason: string | null;
    has_proof: boolean;
  };
  reservation: {
    id: string;
    booker_name: string;
    booker_phone: string | null;
    contact_email: string | null;
    status: string;
    payment_status: string | null;
    created_at: string;
  };
  trip: {
    id: string;
    departure_time: string;
    vehicle_type: string;
    seat_price: number | null;
    origin: string;
    destination: string;
  } | null;
  passengers: AgencyPaymentPassenger[];
  allocations: AgencyPaymentAllocation[];
  /**
   * MKT-010.1 — progreso del pago. `null` en reservas que no son del
   * marketplace (legacy / creadas desde la agencia).
   */
  progress: AgencyPaymentProgress | null;
  totals: {
    active_passenger_count: number;
    expected_cents: number;
    allocated_cents: number;
    remaining_cents: number;
  };
}

export interface PaymentProofSignedUrlResult {
  url: string;
  expires_in_seconds: number;
}

export interface VerifyPaymentResult {
  payment_id: string;
  reservation_id: string;
  status: string;
  /** MKT-010.1 — etapa verificada (`full` | `deposit` | `balance`). */
  stage?: AgencyPaymentStage;
  already_verified: boolean;
  amount_cents: number;
  currency: string;
  allocation_count: number;
  total_expected_cents: number;
  verified_at: string;
  verified_by: string;
  payment_status: string;
  audit_id: string;
}

export interface RejectPaymentResult {
  payment_id: string;
  reservation_id: string;
  status: string;
  /** MKT-010.1 — etapa rechazada (`full` | `deposit` | `balance`). */
  stage?: AgencyPaymentStage;
  already_rejected: boolean;
  rejection_reason: string;
  outcome: string;
  cancelled_reservation: boolean;
  reservation_status: string;
  payment_status: string;
  freed_seat_count: number;
  cancelled_passenger_count: number;
  refund_required: boolean;
  refund_amount_cents: number;
  payment_audit_id: string;
  reservation_audit_id: string | null;
}

export interface AgencyPaymentListQuery {
  status?: AgencyPaymentStatusFilter;
  /** MKT-010.1 — filtra por etapa del pago. */
  stage?: AgencyPaymentStageFilter;
  page?: number;
  limit?: number;
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  verified: 'Pago aprobado',
  rejected: 'Rechazado',
};

/**
 * Plurales de cada estado para el mensaje vacío «No hay pagos …»
 * de la vista Pagos (el singular del badge no encaja en esa frase).
 */
export const PAYMENT_STATUS_PLURALS: Record<AgencyPaymentStatusFilter, string> = {
  pending: 'pendientes',
  verified: 'aprobados',
  rejected: 'rechazados',
};

/** MKT-010.1 — etiquetas de etapa del pago. */
export const PAYMENT_STAGE_LABELS: Record<AgencyPaymentStage, string> = {
  full: 'Total',
  deposit: 'Primer pago',
  balance: 'Pago restante',
};

/**
 * Sustantivos en minúscula de cada etapa para el mensaje vacío
 * «No hay {sustantivo} registrado» de la vista Pagos.
 */
export const PAYMENT_STAGE_NOUNS: Record<AgencyPaymentStage, string> = {
  full: 'pago total',
  deposit: 'primer pago',
  balance: 'pago restante',
};

/**
 * MKT-010.1 — chips de etapa de la vista Pagos. `''` = sin filtrar.
 * Vive aquí (y no en la página) para quedar cubierto a nivel unitario.
 * La vista Pagos se expone en /agency/payments con el toggle Pagos/Compras.
 */
export const PAYMENT_STAGE_FILTERS: {
  value: AgencyPaymentStageFilter;
  label: string;
}[] = [
  { value: '', label: 'Todas' },
  { value: 'deposit', label: 'Primer pago' },
  { value: 'balance', label: 'Pago restante' },
  { value: 'full', label: 'Total' },
];

/**
 * MKT-010.1 — badge de la etapa. `full` no se muestra nunca (es el
 * estado por defecto de un pago único); `deposit` y `balance` sí.
 */
export function paymentStageBadgeVariant(
  stage: AgencyPaymentStage,
): 'info' | 'warning' | 'active' | 'inactive' {
  switch (stage) {
    case 'deposit':
      return 'info';
    case 'balance':
      return 'warning';
    default:
      return 'inactive';
  }
}

/** Badge variant asociada a cada estado de pago. */
export function paymentStatusBadgeVariant(
  status: string,
): 'warning' | 'active' | 'cancelled' | 'inactive' {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'verified':
      return 'active';
    case 'rejected':
      return 'cancelled';
    default:
      return 'inactive';
  }
}

export const PAYMENT_REJECT_REASON_REQUIRED =
  'El motivo del rechazo es obligatorio.';
export const PAYMENT_REJECT_REASON_MAX = 500;

// ─── MKT-007 · Checkout attempts (compras en revisión) ──────────────────────

export type AgencyCheckoutAttemptStatus =
  | 'created'
  | 'pending_review'
  | 'rejected'
  | 'verified'
  | 'rejected_final'
  | 'expired'
  | 'cancelled';

export type AgencyCheckoutAttemptStatusFilter =
  | AgencyCheckoutAttemptStatus
  | '';

export interface AgencyCheckoutAttemptListItem {
  id: string;
  status: string;
  amount_cents: number;
  passenger_count: number;
  proof_count: number;
  has_proof: boolean;
  payment_reference: string | null;
  bank_origin: string | null;
  submitted_at: string | null;
  rejection_reason: string | null;
  expires_at: string;
  created_at: string;
  booker: {
    name: string;
    document: string;
    phone: string | null;
  };
  trip: {
    id: string;
    departure_time: string;
    origin: string;
    destination: string;
  } | null;
}

export interface ListAgencyCheckoutAttemptsResult {
  attempts: AgencyCheckoutAttemptListItem[];
  page: number;
  limit: number;
  total: number;
}

export interface AgencyCheckoutAttemptPassenger {
  seat_id: string;
  seat_code: string | null;
  first_name: string;
  last_name: string;
  name: string;
  document: string;
  phone: string | null;
}

export interface AgencyCheckoutAttemptDetail {
  attempt: {
    id: string;
    status: string;
    reservation_id: string | null;
    amount_cents: number;
    /**
     * MKT-010.1 — plan congelado del intento: `single` = pago total;
     * `two_stage` = depósito + saldo (`amount_cents` refleja el depósito).
     */
    payment_plan: 'single' | 'two_stage';
    /** MKT-010.1 — depósito total del intento (NULL en `single`). */
    deposit_cents: number | null;
    unit_price: number;
    passenger_count: number;
    proof_count: number;
    remaining_submissions: number;
    payment_reference: string | null;
    bank_origin: string | null;
    payment_datetime: string | null;
    proof_submitted_at: string | null;
    review_started_at: string | null;
    rejection_reason: string | null;
    rejection_count: number;
    expires_at: string;
    created_at: string;
    closed_at: string | null;
    verified_at: string | null;
    verified_by: string | null;
    has_proof: boolean;
    /** MKT-007.4: canal elegido por el cliente (snapshot inmutable). */
    payment_method_id: string | null;
    /**
     * MKT-007.4: snapshot del canal elegido. JSONB crudo del backend: la
     * forma no está garantizada en runtime. Validar SIEMPRE con
     * parseAgencyPaymentMethodSnapshot antes de usarlo.
     */
    payment_method_snapshot: unknown;
  };
  trip: {
    id: string;
    departure_time: string;
    vehicle_type: string;
    seat_price: number | null;
    origin: string;
    destination: string;
  } | null;
  passengers: AgencyCheckoutAttemptPassenger[];
  history: unknown[];
}

export interface CheckoutAttemptProofSignedUrlResult {
  url: string;
  expires_in_seconds: number;
}

export interface VerifyCheckoutAttemptResult {
  attempt_id: string;
  status: string;
  already_verified: boolean;
  reservation_id: string | null;
  payment_id: string | null;
  amount_cents: number;
  currency: string;
  /**
   * MKT-010.1 — datos del plan devueltos por la RPC al aprobar.
   * Opcionales: los resultados idempotentes de filas antiguas pueden
   * no traerlos.
   */
  payment_plan?: 'single' | 'two_stage';
  deposit_cents?: number | null;
  total_cents?: number | null;
  balance_cents?: number | null;
  deposit_pct?: number | null;
  balance_pct?: number | null;
  deposit_deadline?: string | null;
  balance_deadline?: string | null;
  proof_count: number;
  allocation_count: number;
  passenger_count: number;
  verified_at: string;
  verified_by: string;
  payment_status: string;
  audit_id: string;
  reservation_audit_id: string | null;
}

export interface RejectCheckoutAttemptResult {
  attempt_id: string;
  status: string;
  already_rejected: boolean;
  final: boolean;
  proof_count: number;
  remaining_submissions: number;
  rejection_reason: string;
  freed_seats: number;
  audit_id: string | null;
}

export interface AgencyCheckoutAttemptListQuery {
  status?: AgencyCheckoutAttemptStatusFilter;
  trip_id?: string;
  q?: string;
  page?: number;
  limit?: number;
}

export const CHECKOUT_ATTEMPT_STATUS_LABELS: Record<string, string> = {
  created: 'Creada',
  pending_review: 'En revisión',
  rejected: 'Rechazada',
  verified: 'Verificada',
  rejected_final: 'Rechazada definitivamente',
  expired: 'Expirada',
  cancelled: 'Cancelada',
};

export function checkoutAttemptStatusBadgeVariant(
  status: string,
): 'warning' | 'active' | 'cancelled' | 'inactive' {
  switch (status) {
    case 'created':
    case 'pending_review':
      return 'warning';
    case 'verified':
      return 'active';
    case 'rejected':
    case 'rejected_final':
      return 'cancelled';
    default:
      return 'inactive';
  }
}

// ─── MKT-007.4 · Canales de pago de la agencia ───────────────────────────────

/** Copia inmutable del canal elegida al momento de la selección. */
export interface AgencyPaymentMethodSnapshot {
  method: string;
  label: string;
  data: Record<string, unknown>;
  is_primary?: boolean;
  snapshot_version?: number;
  selected_at?: string;
}

export interface AgencyPaymentMethod {
  id: string;
  agency_id: string;
  method: string;
  label: string;
  data: Record<string, unknown>;
  is_active: boolean;
  is_primary: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateAgencyPaymentMethodInput {
  method: 'pago_movil';
  label: string;
  data: AgencyPagoMovilData;
  is_primary?: boolean;
  sort_order?: number;
}

export interface UpdateAgencyPaymentMethodInput {
  label?: string;
  data?: AgencyPagoMovilData;
  is_active?: boolean;
}

/** Datos válidos del canal pago_movil (espejo del schema Zod del backend). */
export interface AgencyPagoMovilData {
  bank_code: string;
  bank_name: string;
  phone: string;
  document_type: 'V' | 'E' | 'J' | 'G';
  document_number: string;
  holder_name: string;
  account_type?: 'checking' | 'savings';
  account_number?: string;
}

/** Error HTTP 409 devuelto cuando la agencia tiene compras activas. */
export const AGENCY_HAS_ACTIVE_CHECKOUTS_CODE = 'AGENCY_HAS_ACTIVE_CHECKOUTS';

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pago_movil: 'Pago móvil',
};

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  V: 'Venezolano',
  E: 'Extranjero',
  J: 'Jurídico',
  G: 'Gubernamental',
};

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  checking: 'Corriente',
  savings: 'Ahorro',
};

/**
 * MKT-007.4: valida en runtime la estructura de un snapshot de canal
 * proveniente del JSONB del backend. Devuelve `null` cuando el valor no es
 * un snapshot utilizable (no-objeto, method/label ausentes o no-string, o
 * data que no es un objeto). Nunca inventa datos: un snapshot inválido no
 * se muestra como si fuera válido.
 */
export function parseAgencyPaymentMethodSnapshot(
  value: unknown,
): AgencyPaymentMethodSnapshot | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.method !== 'string' || raw.method.trim() === '') return null;
  if (typeof raw.label !== 'string' || raw.label.trim() === '') return null;
  if (
    typeof raw.data !== 'object' ||
    raw.data === null ||
    Array.isArray(raw.data)
  ) {
    return null;
  }
  return {
    method: raw.method,
    label: raw.label,
    data: raw.data as Record<string, unknown>,
    is_primary: typeof raw.is_primary === 'boolean' ? raw.is_primary : undefined,
    snapshot_version:
      typeof raw.snapshot_version === 'number' ? raw.snapshot_version : undefined,
    selected_at: typeof raw.selected_at === 'string' ? raw.selected_at : undefined,
  };
}

function snapshotString(
  data: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}

/**
 * MKT-007.4: describe el snapshot del canal para mostrarlo al agente.
 * Usa SOLO campos de texto presentes en `data`; los valores no-string se
 * ignoran en lugar de renderizarse como "undefined".
 */
export function describePaymentMethodSnapshot(
  snapshot: AgencyPaymentMethodSnapshot,
): string {
  const data =
    typeof snapshot.data === 'object' &&
    snapshot.data !== null &&
    !Array.isArray(snapshot.data)
      ? snapshot.data
      : {};
  const parts: string[] = [];
  const methodLabel = PAYMENT_METHOD_LABELS[snapshot.method] ?? snapshot.method;
  parts.push(methodLabel);

  const bankName = snapshotString(data, 'bank_name');
  const bankCode = snapshotString(data, 'bank_code');
  if (bankName) {
    parts.push(bankCode ? `${bankName} (${bankCode})` : bankName);
  }
  const phone = snapshotString(data, 'phone');
  if (phone) parts.push(`Tel. ${phone}`);
  const holder = snapshotString(data, 'holder_name');
  if (holder) {
    const docTypeRaw = snapshotString(data, 'document_type');
    const docNumber = snapshotString(data, 'document_number');
    const docType = docTypeRaw
      ? (DOCUMENT_TYPE_LABELS[docTypeRaw] ?? docTypeRaw)
      : '';
    const doc = docType && docNumber ? `${docType} ${docNumber}` : '';
    parts.push(doc ? `${holder} · ${doc}` : holder);
  }
  return parts.join(' · ');
}

/**
 * Resumen conciso del canal para la tarjeta de detalle: solo banco,
 * teléfono y documento del titular. Omite nombre del titular y datos
 * de cuenta para no saturar la vista de revisión.
 */
export function describeChannelSummary(
  snapshot: AgencyPaymentMethodSnapshot,
): string {
  const data =
    typeof snapshot.data === 'object' &&
    snapshot.data !== null &&
    !Array.isArray(snapshot.data)
      ? snapshot.data
      : {};
  const parts: string[] = [];

  const bankName = snapshotString(data, 'bank_name');
  const bankCode = snapshotString(data, 'bank_code');
  if (bankName) {
    parts.push(bankCode ? `${bankName} (${bankCode})` : bankName);
  }

  const phone = snapshotString(data, 'phone');
  if (phone) parts.push(`Tel. ${phone}`);

  const docTypeRaw = snapshotString(data, 'document_type');
  const docNumber = snapshotString(data, 'document_number');
  const docType = docTypeRaw
    ? (DOCUMENT_TYPE_LABELS[docTypeRaw] ?? docTypeRaw)
    : '';
  const doc = docType && docNumber ? `${docType} ${docNumber}` : '';
  if (doc) parts.push(doc);

  return parts.join(' · ');
}

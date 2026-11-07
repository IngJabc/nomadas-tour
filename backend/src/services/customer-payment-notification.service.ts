import { supabaseAdmin } from '../config/database.js';

/**
 * PAY-NOTIFICATIONS Task 6 — notificaciones de pago del CLIENTE sobre la
 * tabla `customer_notifications` (definida en 098, tipos de pago
 * ampliados por 101).
 *
 * Tipos soportados (los únicos que 101 añade para pagos):
 *   - `payment_verified`: pago aprobado → boleto del cliente.
 *   - `payment_rejected`: pago rechazado → corrección en Mis compras.
 *
 * Esquema REAL inspeccionado (098) — columnas usadas:
 *   customer_id, type, title, body, entity_type, entity_id, action_url.
 *   NO existe `source_event_id` ni `metadata`, y NO hay índice único de
 *   negocio: la idempotencia es un pre-check por clave natural
 *   (customer_id, type, entity_type, entity_id) — best-effort y NO
 *   atómico (una carrera concurrente puede duplicar; hacerlo atómico
 *   exigiría un índice único = migración, fuera del alcance de esta
 *   tarea). Un conflicto 23505 se trata como duplicado defensivo.
 *
 * Entidad (CHECK de 098: `entity_type IN ('reservation','review_request')`):
 *   - `payment_verified` → `reservation` con el `reservation_id` REAL que
 *     devuelve `verify_checkout_attempt` (la reserva nace al verificar).
 *   - `payment_rejected` → el rechazo NO crea reserva (087): se usa el
 *     `attempt_id` como `entity_id` bajo el único tipo legal disponible.
 *     Es un workaround documentado del CHECK (no existe tipo `attempt` y
 *     esta tarea no agrega migraciones); la navegación real la lleva
 *     `action_url`.
 *
 * Ownership: todos los campos son contexto SERVER-SIDE (envelope
 * `CheckoutReviewOutcome` de la Task 2 / resultados de RPC). Este módulo
 * no tiene capa HTTP y jamás acepta datos de identidad ni propiedad del
 * request del cliente.
 *
 * Sin datos sensibles: ni montos, ni motivos de rechazo, ni referencias
 * bancarias, ni rutas de comprobantes (storage).
 *
 * Aislamiento: NUNCA lanza. Todo fallo vuelve `{ status: 'failed' }` con
 * log (convención del backend Tour: `console.error(JSON.stringify({…}))`).
 * Eventos: CUSTOMER_NOTIFICATION_INVALID_INPUT,
 * CUSTOMER_NOTIFICATION_LOOKUP_FAILED, CUSTOMER_NOTIFICATION_INSERT_FAILED.
 *
 * Aún NO está conectada a `CheckoutAttemptService` (la integración es una
 * tarea posterior de PAY-NOTIFICATIONS).
 */

export type CustomerPaymentNotificationType =
  | 'payment_verified'
  | 'payment_rejected';

export type CustomerPaymentNotificationInput =
  | {
      /** Aprobación del pago. */
      type: 'payment_verified';
      /**
       * `users.id` del dueño — llega del envelope server-side de la Task 2
       * (puede ser `null` si la lookup del intento falló: se valida aquí).
       */
      customerId: string | null;
      /** `checkout_attempts.id` — compra revisada (action_url + clave de dedupe). */
      attemptId: string;
      /**
       * `reservations.id` REAL devuelto por la RPC de verificación
       * (`VerifyCheckoutAttemptResult.reservation_id`, nullable en el
       * contrato del RPC: se valida aquí).
       */
      reservationId: string | null;
    }
  | {
      /** Rechazo del pago (parcial o final). */
      type: 'payment_rejected';
      customerId: string | null;
      attemptId: string;
    };

export type CustomerPaymentNotificationStatus =
  | 'inserted'
  | 'duplicate'
  | 'failed';

export interface CustomerPaymentNotificationResult {
  status: CustomerPaymentNotificationStatus;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Copy fijo por tipo (098 fija el copy en SQL para `review_pending`;
 * aquí vive en código). Sin montos ni motivos: el detalle real está en
 * la página de la compra.
 */
const COPY: Record<
  CustomerPaymentNotificationType,
  { title: string; body: string; actionPath: (attemptId: string) => string }
> = {
  payment_verified: {
    title: 'Pago verificado',
    body: 'Tu pago fue aprobado. Ya puedes ver el boleto y los detalles de tu compra.',
    actionPath: (attemptId) => `/account/purchases/${attemptId}/ticket`,
  },
  payment_rejected: {
    title: 'Pago rechazado',
    body: 'Tu pago no fue aprobado. Revisa el estado de tu compra para ver el detalle.',
    actionPath: (attemptId) => `/account/purchases/${attemptId}/payment`,
  },
};

/** Fila mínima: solo columnas que 098 define para esta tabla. */
interface CustomerNotificationInsertRow {
  customer_id: string;
  type: CustomerPaymentNotificationType;
  title: string;
  body: string;
  entity_type: 'reservation';
  entity_id: string;
  action_url: string;
}

function invalidInput(
  field: string,
  type: unknown,
): CustomerPaymentNotificationResult {
  console.error(
    JSON.stringify({
      event: 'CUSTOMER_NOTIFICATION_INVALID_INPUT',
      field,
      type: typeof type === 'string' ? type : null,
    }),
  );
  return { status: 'failed' };
}

/**
 * Inserta la notificación de pago del cliente vía `supabaseAdmin`
 * (service_role: RLS de 098 es deny-by-default para escritura).
 *
 * Flujo:
 *   1. Valida los datos requeridos (sin insertar, sin lanzar).
 *   2. Pre-check por clave natural → si ya existe, `duplicate`.
 *   3. INSERT de la fila mínima → `inserted` (o `duplicate` en 23505).
 *   4. Cualquier fallo → log + `failed` (el caller nunca es afectado).
 */
export async function notifyCustomerPaymentStatus(
  input: CustomerPaymentNotificationInput,
): Promise<CustomerPaymentNotificationResult> {
  // ── 1) Datos requeridos (runtime: también protege a callers JS) ────────────
  const raw = input as { type?: unknown } | null | undefined;
  const type: unknown = raw?.type;
  if (type !== 'payment_verified' && type !== 'payment_rejected') {
    return invalidInput('type', type);
  }
  const typed = input as CustomerPaymentNotificationInput;

  const customerId: unknown = typed.customerId;
  if (!isUuid(customerId)) {
    return invalidInput('customer_id', type);
  }

  const attemptId: unknown = typed.attemptId;
  if (!isUuid(attemptId)) {
    return invalidInput('attempt_id', type);
  }

  // ── Entidad según el tipo (ver doc: el rechazo no tiene reserva) ──────────
  let entityId: string;
  if (typed.type === 'payment_verified') {
    const reservationId: unknown = typed.reservationId;
    if (!isUuid(reservationId)) {
      return invalidInput('reservation_id', type);
    }
    entityId = reservationId;
  } else {
    entityId = attemptId;
  }

  const copy = COPY[typed.type];
  const row: CustomerNotificationInsertRow = {
    customer_id: customerId,
    type: typed.type,
    title: copy.title,
    body: copy.body,
    entity_type: 'reservation',
    entity_id: entityId,
    action_url: copy.actionPath(attemptId),
  };

  // ── 2–4) Base de datos, con log observable en cada fallo ──────────────────
  let stage: 'lookup' | 'insert' = 'lookup';
  try {
    const { data, error } = await supabaseAdmin
      .from('customer_notifications')
      .select('id')
      .eq('customer_id', customerId)
      .eq('type', typed.type)
      .eq('entity_type', 'reservation')
      .eq('entity_id', entityId)
      .maybeSingle();

    if (error) {
      // Sin pre-check no se puede garantizar idempotencia → no se inserta.
      console.error(
        JSON.stringify({
          event: 'CUSTOMER_NOTIFICATION_LOOKUP_FAILED',
          type: typed.type,
          attemptId,
          error: error.message,
        }),
      );
      return { status: 'failed' };
    }

    // Reentrega del mismo evento (misma clave natural) → idempotente.
    if (data) {
      return { status: 'duplicate' };
    }

    stage = 'insert';
    const { error: insertError } = await supabaseAdmin
      .from('customer_notifications')
      .insert(row);

    if (!insertError) {
      return { status: 'inserted' };
    }

    // Defensivo: hoy no hay índice único sobre la clave natural (23505
    // sería solo colisión de PK); si más adelante se agrega un índice
    // único, la reentrega queda cubierta sin cambiar este servicio.
    if ((insertError as { code?: string }).code === '23505') {
      return { status: 'duplicate' };
    }

    console.error(
      JSON.stringify({
        event: 'CUSTOMER_NOTIFICATION_INSERT_FAILED',
        type: typed.type,
        attemptId,
        entityId,
        error: insertError.message,
      }),
    );
    return { status: 'failed' };
  } catch (error) {
    // Red/caída del cliente Supabase: también aislado y observable.
    console.error(
      JSON.stringify({
        event:
          stage === 'lookup'
            ? 'CUSTOMER_NOTIFICATION_LOOKUP_FAILED'
            : 'CUSTOMER_NOTIFICATION_INSERT_FAILED',
        type: typed.type,
        attemptId,
        entityId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { status: 'failed' };
  }
}

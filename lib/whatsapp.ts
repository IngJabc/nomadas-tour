export function whatsappHref(phone: string | null | undefined): string | null {
  const raw = (phone ?? '').trim();
  if (!raw) return null;

  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `58${digits.slice(1)}`;

  if (!/^[1-9]\d{10,14}$/.test(digits)) return null;
  return `https://wa.me/${digits}`;
}

export interface CheckoutRejectWhatsAppMessageInput {
  bookerName: string | null;
  seatCodes: string[];
  origin: string | null;
  destination: string | null;
  departureLabel: string | null;
  agencyName: string | null;
  reason: string | null;
}

export function buildCheckoutRejectWhatsAppMessage(
  input: CheckoutRejectWhatsAppMessageInput,
): string {
  const name = input.bookerName?.trim() || 'cliente';
  const seats = input.seatCodes.map((code) => code.trim()).filter(Boolean).join(', ') || '—';
  const origin = input.origin?.trim() || '—';
  const destination = input.destination?.trim() || '—';
  const departure = input.departureLabel?.trim() || '—';
  const agency = input.agencyName?.trim() || 'la agencia';
  const reason = input.reason?.trim() || '—';

  return (
    `Hola ${name}:\n\n` +
    `Tu pago para la reserva de los asientos ${seats} del viaje ${origin} → ${destination} del ${departure} con la agencia ${agency} fue rechazado.\n\n` +
    `Motivo: ${reason}\n\n` +
    'Por favor, contacta a la agencia o sube un nuevo comprobante desde el enlace de tu reserva.\n\n' +
    '— Equipo Nómadas Tour'
  );
}

// ─── MKT-010.1 · Solicitud de saldo (plan de pago en dos partes) ─────────────

export interface BalanceRequestWhatsAppMessageInput {
  bookerName: string | null;
  seatCodes: string[];
  origin: string | null;
  destination: string | null;
  departureLabel: string | null;
  agencyName: string | null;
  /** Saldo pendiente ya formateado, p. ej. "$ 120.000". */
  balanceLabel: string;
  /** Vencimiento del saldo ya formateado, p. ej. "20/11/2026". */
  balanceDeadlineLabel?: string | null;
}

/**
 * MKT-010.1 (lado Tour) — mensaje de WhatsApp con el que la agencia le
 * pide al cliente el SALDO restante de una reserva de dos partes.
 *
 * Mismos fallbacks que el builder de rechazo: nunca se imprime
 * "undefined" ni "null" en un mensaje que se envía a un cliente.
 */
export function buildBalanceRequestWhatsAppMessage(
  input: BalanceRequestWhatsAppMessageInput,
): string {
  const name = input.bookerName?.trim() || 'cliente';
  const seats =
    input.seatCodes.map((code) => code.trim()).filter(Boolean).join(', ') || '—';
  const origin = input.origin?.trim() || '—';
  const destination = input.destination?.trim() || '—';
  const departure = input.departureLabel?.trim() || '—';
  const agency = input.agencyName?.trim() || 'la agencia';
  const balance = input.balanceLabel?.trim() || '—';
  const deadline = input.balanceDeadlineLabel?.trim();

  return (
    `Hola ${name}:\n\n` +
    `Tu reserva de los asientos ${seats} del viaje ${origin} → ${destination} del ${departure} con la agencia ${agency} tiene un saldo pendiente de ${balance}.` +
    (deadline ? `\n\nFecha límite de pago: ${deadline}.` : '') +
    '\n\nCoordina el pago con la agencia y envía el comprobante para completar la reserva.' +
    '\n\n— Equipo Nómadas Tour'
  );
}

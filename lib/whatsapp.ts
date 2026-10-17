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

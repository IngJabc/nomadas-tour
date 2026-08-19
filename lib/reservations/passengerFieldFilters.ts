const LETTER_RE = /[^a-zA-ZáéíóúñüÁÉÍÓÚÑÜ\s\-']/g;
const PHONE_RE = /[^\d+]/g;

export function filterPassengerName(v: string): string {
  return v.replace(LETTER_RE, '');
}

export function filterPassengerDocument(v: string): string {
  return v.replace(/\D/g, '').slice(0, 8);
}

export function filterPassengerPhone(v: string): string {
  const clean = v.replace(PHONE_RE, '');
  const plusIndex = clean.indexOf('+');
  if (plusIndex > 0) return '+' + clean.replace(/\+/g, '').slice(0, 12);
  return clean.replace(/(?<=.)\+/g, '').slice(0, 13);
}

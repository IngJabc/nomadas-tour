const QR_PREFIX = 'NT-';
const MIN_QR_LENGTH = 10;

export function normalizeQrCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidQrCode(raw: string): boolean {
  const normalized = normalizeQrCode(raw);
  if (normalized.length < MIN_QR_LENGTH) return false;
  if (!normalized.startsWith(QR_PREFIX)) return false;
  return true;
}

export function validateQrInput(raw: string): { valid: boolean; error?: string } {
  const normalized = normalizeQrCode(raw);
  if (!normalized) return { valid: false, error: 'El código QR no puede estar vacío' };
  if (normalized.length < MIN_QR_LENGTH) return { valid: false, error: 'El código QR es demasiado corto' };
  if (!normalized.startsWith(QR_PREFIX)) return { valid: false, error: 'El código QR no parece válido' };
  return { valid: true };
}

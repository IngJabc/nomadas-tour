const QR_PREFIX = 'NT-';
const MIN_QR_LENGTH = 10;
const TICKET_CODE_RE = /^[A-F0-9]{8}$/;

export function normalizeQrCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isTicketCode(raw: string): boolean {
  return TICKET_CODE_RE.test(normalizeQrCode(raw));
}

export function isValidQrCode(raw: string): boolean {
  const normalized = normalizeQrCode(raw);
  if (normalized.length < MIN_QR_LENGTH) return false;
  if (!normalized.startsWith(QR_PREFIX)) return false;
  return true;
}

/** Exact boarding credential: 8-char ticket_code or full NT- QR. No fragments. */
export function validateBoardingCredential(
  raw: string,
): { valid: boolean; error?: string } {
  const normalized = normalizeQrCode(raw);
  if (!normalized) {
    return { valid: false, error: 'El código no puede estar vacío' };
  }
  if (isTicketCode(normalized)) {
    return { valid: true };
  }
  if (isValidQrCode(normalized)) {
    return { valid: true };
  }
  if (normalized.length === 8) {
    return {
      valid: false,
      error: 'El código de ticket debe ser 8 caracteres hexadecimales (A–F, 0–9)',
    };
  }
  return {
    valid: false,
    error: 'Ingresa un código de ticket de 8 caracteres o el QR completo',
  };
}

/** @deprecated Prefer validateBoardingCredential for scanner/manual lookup */
export function validateQrInput(raw: string): { valid: boolean; error?: string } {
  return validateBoardingCredential(raw);
}

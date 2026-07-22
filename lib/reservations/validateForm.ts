export interface ValidationError {
  field: string;
  message: string;
}

export interface PassengerValidation {
  seat_id: string;
  seat_code: string;
  errors: ValidationError[];
}

const PHONE_STRIP_RE = /[\s\-]/g;

function isValidPhone(phone: string): boolean {
  const stripped = phone.replace(PHONE_STRIP_RE, '');
  // Local: 0424xxxxxxx → 11 digits
  // International: +58424xxxxxxx → + followed by 12 digits
  if (/^\d{11}$/.test(stripped)) return true;
  if (/^\+\d{12}$/.test(stripped)) return true;
  return false;
}

export function validatePassengerForm(
  bookerName: string,
  bookerDocument: string,
  passengers: { seat_id: string; seat_code: string; name: string; document: string; phone?: string }[]
): { bookerErrors: { name?: string; document?: string }; passengerErrors: PassengerValidation[] } {
  const bookerErrors: { name?: string; document?: string } = {};

  if (!bookerName.trim()) {
    bookerErrors.name = 'El nombre es requerido';
  } else if (bookerName.trim().length < 2) {
    bookerErrors.name = 'Mínimo 2 caracteres';
  }

  if (!bookerDocument.trim()) {
    bookerErrors.document = 'El documento es requerido';
  } else if (!/^\d{8}$/.test(bookerDocument.trim())) {
    bookerErrors.document = 'Debe ser exactamente 8 dígitos';
  }

  const passengerErrors: PassengerValidation[] = passengers.map((p) => {
    const errors: ValidationError[] = [];

    if (!p.name.trim()) {
      errors.push({ field: 'name', message: 'Nombre requerido' });
    } else if (p.name.trim().length < 2) {
      errors.push({ field: 'name', message: 'Mínimo 2 caracteres' });
    }

    if (!p.document.trim()) {
      errors.push({ field: 'document', message: 'Documento requerido' });
    } else if (!/^\d{8}$/.test(p.document.trim())) {
      errors.push({ field: 'document', message: 'Debe ser exactamente 8 dígitos' });
    }

    if (p.phone && p.phone.trim() && !isValidPhone(p.phone.trim())) {
      errors.push({ field: 'phone', message: 'Formato: 0424xxxxxxx o +58424xxxxxxx' });
    }

    return { seat_id: p.seat_id, seat_code: p.seat_code, errors };
  });

  return { bookerErrors, passengerErrors };
}

export function hasValidationErrors(
  result: { bookerErrors: { name?: string; document?: string }; passengerErrors: PassengerValidation[] }
): boolean {
  if (result.bookerErrors.name || result.bookerErrors.document) return true;
  return result.passengerErrors.some((p) => p.errors.length > 0);
}

export function buildErrorMap(
  bookerErrors: { name?: string; document?: string },
  passengerErrors: PassengerValidation[]
): Record<string, string> {
  const map: Record<string, string> = {};
  if (bookerErrors.name) map['booker_name'] = bookerErrors.name;
  if (bookerErrors.document) map['booker_document'] = bookerErrors.document;
  for (const p of passengerErrors) {
    for (const err of p.errors) {
      map[`${p.seat_id}_${err.field}`] = err.message;
    }
  }
  return map;
}

// Compatibility wrapper used by page.tsx
export function validateForm(
  _step: string,
  _trip: unknown,
  _seats: unknown[],
  bookerName: string,
  bookerDocument: string,
  passengers: { seat_id: string; seat_code: string; name: string; document: string; phone?: string }[]
): Record<string, string> {
  const result = validatePassengerForm(bookerName, bookerDocument, passengers);
  if (!hasValidationErrors(result)) return {};
  return buildErrorMap(result.bookerErrors, result.passengerErrors);
}

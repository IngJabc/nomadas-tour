import type {
  BoardingLookupDTO,
  BoardingLookupFailureCode,
  BoardingLookupPassenger,
  BoardingLookupResponse,
  BoardingToggleResult,
} from '@/lib/api';
import { ApiError } from '@/lib/errors/api-error';

const PII_KEYS = [
  'qr_code',
  'booker_document',
  'booker_name',
  'booker_phone',
  'document',
  'phone',
] as const;

/** Stable domain codes for scanner UX (never shown raw to operators). */
export type BoardingDomainCode =
  | 'CREDENTIAL_NOT_FOUND'
  | 'PASSENGER_NOT_FOUND'
  | 'AGENCY_NOT_ASSIGNED'
  | 'ACTOR_UNAUTHORIZED'
  | 'TRIP_NOT_DEPARTED'
  | 'TRIP_CANCELLED'
  | 'TRIP_COMPLETED'
  | 'TRIP_ARCHIVED'
  | 'TRIP_INVALID'
  | 'PASSENGER_CANCELLED'
  | 'RESERVATION_CANCELLED'
  | 'INVALID_INPUT'
  | 'AGENCY_INACTIVE'
  | 'UNKNOWN';

export type BoardingErrorContext = 'lookup' | 'toggle' | 'bulk';

const OPERATOR_MESSAGES: Record<
  BoardingDomainCode,
  Record<BoardingErrorContext, string>
> = {
  CREDENTIAL_NOT_FOUND: {
    lookup: 'No se encontró una reserva con ese código',
    toggle: 'No se encontró la reserva',
    bulk: 'No se encontró la reserva',
  },
  PASSENGER_NOT_FOUND: {
    lookup: 'No se encontró el pasajero',
    toggle: 'No se encontró el pasajero',
    bulk: 'No se encontró uno de los pasajeros',
  },
  AGENCY_NOT_ASSIGNED: {
    lookup: 'Tu agencia no está asignada a este viaje',
    toggle: 'Tu agencia no está asignada a este viaje',
    bulk: 'Tu agencia no está asignada a este viaje',
  },
  ACTOR_UNAUTHORIZED: {
    lookup: 'No tienes permiso para operar el abordaje',
    toggle: 'No tienes permiso para operar el abordaje',
    bulk: 'No tienes permiso para operar el abordaje',
  },
  TRIP_NOT_DEPARTED: {
    lookup: 'Este viaje aún no ha salido. El abordaje no está disponible',
    toggle: 'Este viaje aún no ha salido. El abordaje no está disponible',
    bulk: 'Este viaje aún no ha salido. El abordaje no está disponible',
  },
  TRIP_CANCELLED: {
    lookup: 'Este viaje fue cancelado. No es posible abordar',
    toggle: 'Este viaje fue cancelado. No es posible abordar',
    bulk: 'Este viaje fue cancelado. No es posible abordar',
  },
  TRIP_COMPLETED: {
    lookup: 'Este viaje ya fue completado. No es posible abordar',
    toggle: 'Este viaje ya fue completado. No es posible abordar',
    bulk: 'Este viaje ya fue completado. No es posible abordar',
  },
  TRIP_ARCHIVED: {
    lookup: 'Este viaje fue archivado. No es posible abordar',
    toggle: 'Este viaje fue archivado. No es posible abordar',
    bulk: 'Este viaje fue archivado. No es posible abordar',
  },
  TRIP_INVALID: {
    lookup: 'Este viaje no permite abordaje en este momento',
    toggle: 'Este viaje no permite abordaje en este momento',
    bulk: 'Este viaje no permite abordaje en este momento',
  },
  PASSENGER_CANCELLED: {
    lookup: 'Ese pasajero está cancelado',
    toggle: 'No se puede abordar un pasajero cancelado',
    bulk: 'Hay pasajeros cancelados que no se pueden abordar',
  },
  RESERVATION_CANCELLED: {
    lookup: 'Esta reserva fue cancelada',
    toggle: 'Esta reserva fue cancelada',
    bulk: 'Esta reserva fue cancelada',
  },
  INVALID_INPUT: {
    lookup: 'El código ingresado no es válido',
    toggle: 'No se pudo actualizar el abordaje',
    bulk: 'No se pudo actualizar el abordaje',
  },
  AGENCY_INACTIVE: {
    lookup: 'Tu cuenta de agencia está inactiva',
    toggle: 'Tu cuenta de agencia está inactiva',
    bulk: 'Tu cuenta de agencia está inactiva',
  },
  UNKNOWN: {
    lookup: 'No se pudo buscar la reserva. Intenta de nuevo',
    toggle: 'No se pudo actualizar el abordaje. Intenta de nuevo',
    bulk: 'No se pudo abordar a los pasajeros. Intenta de nuevo',
  },
};

/** Resolve a stable domain code from API/status/message without leaking internals. */
export function resolveBoardingDomainCode(error: unknown): BoardingDomainCode {
  if (error instanceof ApiError) {
    if (error.code === 'AGENCY_INACTIVE') return 'AGENCY_INACTIVE';

    const msg = (error.message || '').toLowerCase();

    if (/no está asignada/.test(msg)) return 'AGENCY_NOT_ASSIGNED';
    if (/no pertenece a la agencia|actor no encontrado/.test(msg)) {
      return 'ACTOR_UNAUTHORIZED';
    }
    if (/aún no ha salido/.test(msg)) return 'TRIP_NOT_DEPARTED';
    if (/viaje fue cancelado|viaje cancelado/.test(msg)) return 'TRIP_CANCELLED';
    if (/viaje ya fue completado|viaje completado/.test(msg)) {
      return 'TRIP_COMPLETED';
    }
    if (/viaje fue archivado|viaje archivado/.test(msg)) return 'TRIP_ARCHIVED';
    if (/no permite boarding|no permite abordaje/.test(msg)) return 'TRIP_INVALID';
    if (/pasajero cancelado/.test(msg)) return 'PASSENGER_CANCELLED';
    if (/reserva fue cancelada|reserva cancelada/.test(msg)) {
      return 'RESERVATION_CANCELLED';
    }
    if (/pasajero no encontrado/.test(msg)) return 'PASSENGER_NOT_FOUND';
    if (/reserva no encontrada|viaje no encontrado/.test(msg)) {
      return 'CREDENTIAL_NOT_FOUND';
    }
    if (/parámetros de boarding incompletos/.test(msg)) return 'INVALID_INPUT';

    if (error.code === 'FORBIDDEN') return 'AGENCY_NOT_ASSIGNED';
    if (error.code === 'NOT_FOUND') return 'CREDENTIAL_NOT_FOUND';
    if (error.code === 'VALIDATION_ERROR') return 'INVALID_INPUT';
  }

  return 'UNKNOWN';
}

/** Operator-facing copy only — never return raw API/DB text. */
export function getBoardingOperatorMessage(
  error: unknown,
  context: BoardingErrorContext,
): string {
  const code = resolveBoardingDomainCode(error);
  return OPERATOR_MESSAGES[code][context];
}

const LOOKUP_FAILURE_MESSAGES: Record<BoardingLookupFailureCode, string> = {
  EMPTY_INPUT: 'El código no puede estar vacío',
  CREDENTIAL_NOT_FOUND: OPERATOR_MESSAGES.CREDENTIAL_NOT_FOUND.lookup,
  AGENCY_NOT_ASSIGNED: OPERATOR_MESSAGES.AGENCY_NOT_ASSIGNED.lookup,
  TRIP_NOT_DEPARTED: OPERATOR_MESSAGES.TRIP_NOT_DEPARTED.lookup,
  TRIP_INVALID: OPERATOR_MESSAGES.TRIP_INVALID.lookup,
  TRIP_NOT_FOUND: 'No se encontró el viaje de esa reserva',
  RESERVATION_CANCELLED: OPERATOR_MESSAGES.RESERVATION_CANCELLED.lookup,
};

/** Map lookup envelope failure_code to operator copy (never raw backend text). */
export function getLookupFailureOperatorMessage(
  failureCode: BoardingLookupFailureCode | null | undefined,
): string {
  if (!failureCode) {
    return OPERATOR_MESSAGES.UNKNOWN.lookup;
  }
  return (
    LOOKUP_FAILURE_MESSAGES[failureCode] ?? OPERATOR_MESSAGES.UNKNOWN.lookup
  );
}

/** Blocked lookup responses must not carry DTO/PII. */
export function assertBlockedLookupHasNoPii(
  response: BoardingLookupResponse,
): boolean {
  if (response.allowed) return true;
  if (response.result !== null) return false;
  const root = response as Record<string, unknown>;
  for (const key of PII_KEYS) {
    if (key in root) return false;
  }
  return true;
}

/** True when a lookup payload has no legacy PII fields. */
export function assertNoBoardingPii(dto: BoardingLookupDTO): boolean {
  const root = dto as Record<string, unknown>;
  for (const key of PII_KEYS) {
    if (key in root) return false;
  }
  for (const passenger of dto.passengers) {
    const row = passenger as Record<string, unknown>;
    if ('document' in row || 'phone' in row || 'seat_id' in row) return false;
  }
  return true;
}

export function applyPassengerToggle(
  passengers: BoardingLookupPassenger[],
  result: BoardingToggleResult,
): BoardingLookupPassenger[] {
  return passengers.map((p) =>
    p.id === result.passenger_id
      ? {
          ...p,
          boarded: result.boarded,
          boarded_at: result.boarded_at,
        }
      : p,
  );
}

export type ToggleFeedback =
  | { kind: 'changed'; boarded: boolean }
  | { kind: 'no_change'; boarded: boolean };

export function toggleFeedback(result: BoardingToggleResult): ToggleFeedback {
  if (result.changed) {
    return { kind: 'changed', boarded: result.boarded };
  }
  return { kind: 'no_change', boarded: result.boarded };
}

import {
  ConflictError,
  ForbiddenError,
  GoneError,
  NotFoundError,
  ValidationError,
} from '../errors/index.js';

const PUBLIC_GONE: Record<string, string> = {
  LINK_EXPIRED: 'Este enlace ha expirado.',
  TRIP_CHANGED: 'Este viaje fue modificado. Solicita un nuevo enlace.',
  TRIP_MISSING: 'Este viaje ya no está disponible.',
  LINK_CONFIRMED: 'Esta reserva ya fue confirmada.',
  LINK_CANCELLED: 'Este enlace fue cancelado.',
};

export function mapPublicLinkErrorCode(code: string): never {
  if (code === 'LINK_NOT_FOUND') {
    throw new NotFoundError('Este enlace no existe.');
  }
  const message = PUBLIC_GONE[code];
  if (message) {
    throw new GoneError(message, code);
  }
  throw new ValidationError(code);
}

export function mapReservationLinkRpcError(raw: string): never {
  const codeMatch = raw.match(/ERR_[A-Z0-9_]+/);
  const code = codeMatch?.[0] ?? '';

  switch (code) {
    case 'ERR_LINK_NOT_FOUND':
      throw new NotFoundError('Link not found');
    case 'ERR_LINK_EXPIRED':
      throw new GoneError('Este enlace ha expirado.', 'LINK_EXPIRED');
    case 'ERR_LINK_CONFIRMED':
      throw new GoneError('Esta reserva ya fue confirmada.', 'LINK_CONFIRMED');
    case 'ERR_LINK_CANCELLED':
      throw new GoneError('Este enlace fue cancelado.', 'LINK_CANCELLED');
    case 'ERR_TRIP_MISSING':
      throw new GoneError('Este viaje ya no está disponible.', 'TRIP_MISSING');
    case 'ERR_TRIP_CHANGED':
      throw new GoneError('Este viaje fue modificado. Solicita un nuevo enlace.', 'TRIP_CHANGED');
    case 'ERR_TRIP_NOT_FOUND':
      throw new NotFoundError('Trip not found or not active');
    case 'ERR_TRIP_DEPARTED':
      throw new ConflictError(
        'This trip has already departed. Reservations are no longer accepted.',
      );
    case 'ERR_AGENCY_NOT_ASSIGNED':
      throw new ForbiddenError('Your agency is not assigned to this trip');
    case 'ERR_NO_SEATS':
      throw new ValidationError('At least one seat is required');
    case 'ERR_SEAT_INVALID_LOCK':
      throw new ConflictError(
        'Los asientos ya no están bloqueados. Vuelve a seleccionarlos para continuar.',
      );
    case 'ERR_SEAT_ACTIVE_LINK':
      throw new ConflictError('Uno o más asientos ya tienen un enlace activo');
    case 'ERR_SEAT_NOT_FOUND':
      throw new NotFoundError('One or more seats not found in this trip');
    case 'ERR_SEAT_NOT_IN_LINK':
      throw new ValidationError('Passenger seats do not match this link');
    case 'ERR_PASSENGER_INCOMPLETE':
      throw new ValidationError('Name and document are required for all passengers');
    case 'ERR_PASSENGER_MISMATCH':
      throw new ValidationError('Passenger data mismatch');
    default:
      throw new ValidationError(raw);
  }
}

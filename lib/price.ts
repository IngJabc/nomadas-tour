/**
 * TRIP-PRICE-001 — contrato monetario del precio por asiento.
 *
 * Almacenamiento: `trips.seat_price` INTEGER en CENTAVOS COP
 * (076: NULL = no publicado). Formulario: pesos COP enteros.
 * La única conversión permitida es x100 /100 explicita aqui;
 * nunca se multiplica por 100 en dos capas distintas.
 */

export const COP_CENTS_PER_PESO = 100;

/** Maximo positivo de la columna INTEGER de Postgres. */
export const SEAT_PRICE_MAX_CENTS = 2_147_483_647;

export const SEAT_PRICE_REQUIRED_MESSAGE =
  'El precio por puesto es obligatorio para crear un viaje.';

export const SEAT_PRICE_INVALID_MESSAGE =
  'Ingresa un precio entero en pesos COP, sin decimales ni puntos.';

/** Pesos COP (entero de formulario) -> centavos COP (columna). */
export function copPesosToCents(pesos: number): number {
  return pesos * COP_CENTS_PER_PESO;
}

/** Centavos COP (columna) -> pesos COP enteros (formulario). */
export function centsToCopPesos(cents: number): number {
  return Math.round(cents / COP_CENTS_PER_PESO);
}

/** Formato COP legible, mismo estilo que el marketplace: $250,00. */
export function formatSeatPriceCents(cents: number): string {
  const value = cents / COP_CENTS_PER_PESO;
  return `$${value.toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export interface SeatPriceInputParse {
  /** Centavos COP equivalentes; null = campo vacio. */
  cents: number | null;
  /** true si el texto no es un entero de pesos COP valido. */
  invalid: boolean;
}

/**
 * Parsea el valor crudo del input (solo digitos; vacio permitido).
 * Rechaza decimales, separadores, signos y negativos: el precio se
 * ingresa siempre en pesos COP enteros.
 */
export function parseSeatPricePesosInput(raw: string): SeatPriceInputParse {
  const trimmed = raw.trim();
  if (trimmed === '') return { cents: null, invalid: false };
  if (!/^\d+$/.test(trimmed)) return { cents: null, invalid: true };

  const pesos = Number(trimmed);
  if (!Number.isSafeInteger(pesos)) return { cents: null, invalid: true };

  const cents = copPesosToCents(pesos);
  if (cents > SEAT_PRICE_MAX_CENTS) return { cents: null, invalid: true };

  return { cents, invalid: false };
}

/** Convierte cents de una via existente al texto del input (pesos). */
export function seatPriceCentsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return String(centsToCopPesos(cents));
}

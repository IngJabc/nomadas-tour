/**
 * Business timezone configuration.
 *
 * Matches the frontend value in lib/timezone.ts.
 * All datetime-local inputs from the frontend are naive strings
 * interpreted as this timezone before storage as UTC (TIMESTAMPTZ).
 *
 * Future: per-agency timezone can override this default
 * by reading from agencies.timezone column.
 */
export const BUSINESS_TIMEZONE = 'America/Caracas';

/**
 * Convert a naive datetime-local string (e.g. "2026-07-20T07:00")
 * to a UTC ISO string, interpreting the input as BUSINESS_TIMEZONE.
 *
 * If the input already contains timezone info (+, -, or Z), returns as-is.
 * This is a safety net — the Zod schema already rejects non-naive strings.
 */
export function toUTC(naiveDatetime: string): string {
  const match = naiveDatetime.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return naiveDatetime;

  const [, y, m, d, h, min, s] = match;
  const year = parseInt(y);
  const month = parseInt(m) - 1;
  const day = parseInt(d);
  const hour = parseInt(h);
  const minute = parseInt(min);
  const second = s ? parseInt(s) : 0;

  const utcAssumed = new Date(Date.UTC(year, month, day, hour, minute, second));

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(utcAssumed);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value);

  const tzAsUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );

  const offsetMs = utcAssumed.getTime() - tzAsUTC;
  const correctUTC = new Date(utcAssumed.getTime() + offsetMs);

  return correctUTC.toISOString();
}

import { BUSINESS_TIMEZONE, toUTC } from '@/lib/timezone';

export const MAX_AUDIT_RANGE_DAYS = 90;
const DAY_MS = 86_400_000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Today as YYYY-MM-DD in America/Caracas. */
export function businessTodayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Inclusive calendar-day bounds in business TZ → UTC ISO for API. */
export function dayRangeToUtc(fromYmd: string, toYmd: string): {
  from: string;
  to: string;
} {
  return {
    from: toUTC(`${fromYmd}T00:00:00`),
    to: toUTC(`${toYmd}T23:59:59`),
  };
}

/** Difference in calendar days (to − from). Same day → 0. */
export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

/**
 * Max 90 inclusive calendar days ⇒ (to − from) ≤ 89.
 * Aligns with API instant window when using full-day Caracas bounds.
 */
export function isAuditCalendarRangeValid(fromYmd: string, toYmd: string): boolean {
  const span = daysBetweenYmd(fromYmd, toYmd);
  return span >= 0 && span <= MAX_AUDIT_RANGE_DAYS - 1;
}

export type DatePreset = 'today' | '7d' | '30d' | 'custom';

export function presetToYmdRange(preset: Exclude<DatePreset, 'custom'>): {
  fromYmd: string;
  toYmd: string;
} {
  const toYmd = businessTodayYmd();
  if (preset === 'today') return { fromYmd: toYmd, toYmd };
  if (preset === '7d') return { fromYmd: addDaysYmd(toYmd, -6), toYmd };
  return { fromYmd: addDaysYmd(toYmd, -29), toYmd };
}

import { Ticket, Calendar, UserCheck, XCircle, Trash2, type LucideIcon } from 'lucide-react';

export const NOTIFICATION_ICONS: Record<string, { icon: LucideIcon; bg: string; color: string }> = {
  trip_created: { icon: Calendar, bg: 'bg-[var(--color-cyan-bg)]', color: 'text-[var(--color-brand-cyan)]' },
  trip_cancelled: { icon: XCircle, bg: 'bg-[var(--color-brand-dark-bg)]', color: 'text-[var(--color-brand-blue)]' },
  trip_completed: { icon: Calendar, bg: 'bg-[var(--color-cyan-bg)]', color: 'text-[var(--color-brand-cyan)]' },
  trip_auto_completed: { icon: Calendar, bg: 'bg-[var(--color-cyan-bg)]', color: 'text-[var(--color-brand-cyan)]' },
  trip_postponed: { icon: Calendar, bg: 'bg-[var(--color-brand-mid-bg)]', color: 'text-[var(--color-brand-cyan)]' },
  trip_deleted: { icon: Trash2, bg: 'bg-[var(--color-brand-dark-bg)]', color: 'text-[var(--color-brand-blue)]' },
  reservation_created: { icon: Ticket, bg: 'bg-[var(--color-brand-blue-bg)]', color: 'text-[var(--color-brand-blue)]' },
  reservation_cancelled: { icon: XCircle, bg: 'bg-[var(--color-brand-dark-bg)]', color: 'text-[var(--color-brand-blue)]' },
  passenger_cancelled: { icon: UserCheck, bg: 'bg-[var(--color-brand-dark-bg)]', color: 'text-[var(--color-brand-blue)]' },
};

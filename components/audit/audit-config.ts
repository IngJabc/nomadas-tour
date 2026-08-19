import type { LucideIcon } from 'lucide-react';
import {
  Ban,
  Bell,
  CalendarClock,
  Link2,
  Palette,
  Plus,
  Ticket,
  Undo2,
  UserCheck,
  XCircle,
} from 'lucide-react';
import type { AuditAction, AuditActorRole, AuditEntityType, AuditEventDTO } from '@/types/audit';

export type AuditTone =
  | 'cyan'
  | 'blue'
  | 'red'
  | 'amber'
  | 'green'
  | 'slate'
  | 'violet';

export interface AuditActionConfig {
  label: string;
  icon: LucideIcon;
  tone: AuditTone;
  entityLabel: string;
  summarize: (event: AuditEventDTO) => string | null;
}

const ENTITY_LABELS: Record<AuditEntityType, string> = {
  trip: 'Viaje',
  reservation: 'Reserva',
  reservation_passenger: 'Pasajero',
  agency_settings: 'Branding',
  notification_preferences: 'Notificaciones',
  reservation_link: 'Enlace',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function seatCodesLabel(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const codes = value.filter((v): v is string => typeof v === 'string');
  return codes.length > 0 ? codes.join(', ') : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export const AUDIT_ACTION_CONFIG: Record<AuditAction, AuditActionConfig> = {
  'trip.created': {
    label: 'Viaje creado',
    icon: Plus,
    tone: 'cyan',
    entityLabel: ENTITY_LABELS.trip,
    summarize: () => null,
  },
  'trip.updated': {
    label: 'Viaje actualizado',
    icon: CalendarClock,
    tone: 'blue',
    entityLabel: ENTITY_LABELS.trip,
    summarize: () => null,
  },
  'trip.cancelled': {
    label: 'Viaje cancelado',
    icon: Ban,
    tone: 'red',
    entityLabel: ENTITY_LABELS.trip,
    summarize: () => null,
  },
  'reservation.created': {
    label: 'Reserva creada',
    icon: Ticket,
    tone: 'amber',
    entityLabel: ENTITY_LABELS.reservation,
    summarize: (event) => {
      const after = asRecord(event.after);
      if (!after) return null;
      const count = numberOrNull(after.passenger_count);
      const seats = seatCodesLabel(after.seat_codes);
      const parts: string[] = [];
      if (count != null) {
        parts.push(`${count} pasajero${count === 1 ? '' : 's'}`);
      }
      if (seats) parts.push(seats);
      return parts.length > 0 ? parts.join(' · ') : null;
    },
  },
  'reservation.cancelled': {
    label: 'Reserva cancelada',
    icon: XCircle,
    tone: 'red',
    entityLabel: ENTITY_LABELS.reservation,
    summarize: (event) => {
      const freed = numberOrNull(event.metadata?.freed_seat_count);
      if (freed == null) return null;
      return `Asientos liberados: ${freed}`;
    },
  },
  'boarding.board': {
    label: 'Pasajero abordado',
    icon: UserCheck,
    tone: 'green',
    entityLabel: ENTITY_LABELS.reservation_passenger,
    summarize: (event) => {
      const seat = stringOrNull(event.metadata?.seat_code);
      return seat ? `Asiento ${seat}` : null;
    },
  },
  'boarding.unboard': {
    label: 'Pasajero desabordado',
    icon: Undo2,
    tone: 'slate',
    entityLabel: ENTITY_LABELS.reservation_passenger,
    summarize: (event) => {
      const seat = stringOrNull(event.metadata?.seat_code);
      return seat ? `Asiento ${seat}` : null;
    },
  },
  'agency_settings.updated': {
    label: 'Branding actualizado',
    icon: Palette,
    tone: 'violet',
    entityLabel: ENTITY_LABELS.agency_settings,
    summarize: () => null,
  },
  'notification_preferences.updated': {
    label: 'Notificaciones actualizadas',
    icon: Bell,
    tone: 'violet',
    entityLabel: ENTITY_LABELS.notification_preferences,
    summarize: () => null,
  },
  'reservation_link.created': {
    label: 'Enlace creado',
    icon: Link2,
    tone: 'cyan',
    entityLabel: ENTITY_LABELS.reservation_link,
    summarize: (event) => seatCodesLabel(event.after?.seat_codes),
  },
  'reservation_link.cancelled': {
    label: 'Enlace cancelado',
    icon: XCircle,
    tone: 'red',
    entityLabel: ENTITY_LABELS.reservation_link,
    summarize: () => null,
  },
  'reservation_link.confirmed': {
    label: 'Enlace confirmado',
    icon: Ticket,
    tone: 'green',
    entityLabel: ENTITY_LABELS.reservation_link,
    summarize: () => null,
  },
  'reservation_link.regenerated': {
    label: 'Enlace regenerado',
    icon: Link2,
    tone: 'blue',
    entityLabel: ENTITY_LABELS.reservation_link,
    summarize: () => null,
  },
  'reservation_link.passenger_data_saved': {
    label: 'Datos de pasajero',
    icon: UserCheck,
    tone: 'amber',
    entityLabel: ENTITY_LABELS.reservation_link,
    summarize: () => null,
  },
  'reservation_link.expired': {
    label: 'Enlace expirado',
    icon: Ban,
    tone: 'slate',
    entityLabel: ENTITY_LABELS.reservation_link,
    summarize: () => null,
  },
};

export function getAuditActionConfig(action: string): AuditActionConfig {
  if (action in AUDIT_ACTION_CONFIG) {
    return AUDIT_ACTION_CONFIG[action as AuditAction];
  }
  return {
    label: action,
    icon: Ticket,
    tone: 'slate',
    entityLabel: 'Entidad',
    summarize: () => null,
  };
}

export function getEntityLabel(entityType: string): string {
  if (entityType in ENTITY_LABELS) {
    return ENTITY_LABELS[entityType as AuditEntityType];
  }
  return 'Entidad';
}

/** Short technical id for cards (never invent names). */
export function shortId(id: string | null | undefined, len = 6): string {
  if (!id) return '—';
  return id.slice(0, len);
}

export const TONE_STYLES: Record<
  AuditTone,
  { iconBg: string; iconColor: string; border: string }
> = {
  cyan: {
    iconBg: 'bg-[var(--color-cyan-bg)]',
    iconColor: 'text-[var(--color-brand-cyan)]',
    border: 'var(--color-brand-cyan)',
  },
  blue: {
    iconBg: 'bg-blue-50',
    iconColor: 'text-[var(--color-brand-blue)]',
    border: 'var(--color-brand-blue)',
  },
  red: {
    iconBg: 'bg-[#fef2f2]',
    iconColor: 'text-[#ef4444]',
    border: '#ef4444',
  },
  amber: {
    iconBg: 'bg-[#fffbeb]',
    iconColor: 'text-[#92400e]',
    border: '#f59e0b',
  },
  green: {
    iconBg: 'bg-[#ecfdf5]',
    iconColor: 'text-[#059669]',
    border: '#10b981',
  },
  slate: {
    iconBg: 'bg-slate-100',
    iconColor: 'text-[var(--color-brand-muted)]',
    border: '#94a3b8',
  },
  violet: {
    iconBg: 'bg-violet-50',
    iconColor: 'text-violet-700',
    border: '#7c3aed',
  },
};

export const ACTION_OPTIONS: { value: AuditAction; label: string }[] =
  (Object.keys(AUDIT_ACTION_CONFIG) as AuditAction[]).map((value) => ({
    value,
    label: AUDIT_ACTION_CONFIG[value].label,
  }));

export const ENTITY_TYPE_OPTIONS: { value: AuditEntityType; label: string }[] =
  (Object.keys(ENTITY_LABELS) as AuditEntityType[]).map((value) => ({
    value,
    label: ENTITY_LABELS[value],
  }));

export const ROLE_LABELS: Record<AuditActorRole | 'system', string> = {
  superadmin: 'Superadmin',
  agency: 'Agencia',
  system: 'Sistema',
};

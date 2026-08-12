export const NOTIFICATION_CATEGORIES = [
  'trip_assignments',
  'trip_schedule_changes',
  'trip_status_updates',
  'trip_cancellations',
  'trip_reminders',
  'ops_digest',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const LOCKED_CATEGORIES = new Set<NotificationCategory>([
  'trip_cancellations',
]);

export const NOTIFICATION_TYPE_TO_CATEGORY = {
  trip_created: 'trip_assignments',
  trip_postponed: 'trip_schedule_changes',
  trip_completed: 'trip_status_updates',
  trip_auto_completed: 'trip_status_updates',
  trip_cancelled: 'trip_cancellations',
  trip_archived: 'trip_cancellations',
  trip_reminder: 'trip_reminders',
  ops_digest: 'ops_digest',
  reservation_created: null,
  reservation_cancelled: null,
  passenger_cancelled: null,
} as const satisfies Record<string, NotificationCategory | null>;

export function getCategoryForNotificationType(
  type: string,
): NotificationCategory | null {
  return (
    (NOTIFICATION_TYPE_TO_CATEGORY as Record<string, NotificationCategory | null>)[
      type
    ] ?? null
  );
}

export const CATEGORY_METADATA: {
  key: NotificationCategory;
  label: string;
  description: string;
  locked: boolean;
}[] = [
  {
    key: 'trip_assignments',
    label: 'Nuevos viajes asignados',
    description: 'Cuando el administrador te asigna un viaje nuevo.',
    locked: false,
  },
  {
    key: 'trip_schedule_changes',
    label: 'Cambios de horario',
    description: 'Cuando un viaje asignado cambia su fecha u hora de salida.',
    locked: false,
  },
  {
    key: 'trip_status_updates',
    label: 'Estado del viaje',
    description: 'Cuando un viaje es completado o completado automáticamente.',
    locked: false,
  },
  {
    key: 'trip_cancellations',
    label: 'Cancelaciones y eliminaciones',
    description: 'Cuando un viaje es cancelado o eliminado del sistema.',
    locked: true,
  },
  {
    key: 'trip_reminders',
    label: 'Recordatorios de viaje',
    description: 'Avisos automáticos T-48h y T-24h antes de la salida.',
    locked: false,
  },
  {
    key: 'ops_digest',
    label: 'Resumen operativo diario',
    description: 'Email diario con el estado de viajes, reservas y abordaje.',
    locked: false,
  },
];

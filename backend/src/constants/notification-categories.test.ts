/**
 * PAY-NOTIFICATIONS Task 1 — mapeo tipo → categoría de notificaciones.
 *
 * Los tres tipos de pago deben pertenecer a la categoría nueva
 * `payment_notifications` (preferencia conmutable por la agencia) y
 * el resto del mapa no debe moverse.
 */
import { describe, it, expect } from 'vitest';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPE_TO_CATEGORY,
  CATEGORY_METADATA,
  LOCKED_CATEGORIES,
  getCategoryForNotificationType,
} from './notification-categories.js';

const PAYMENT_TYPES = [
  'payment_receipt_submitted',
  'payment_verified',
  'payment_rejected',
] as const;

const PAYMENT_CATEGORY = 'payment_notifications';

describe('payment_notifications — categoría nueva', () => {
  it('forma parte de NOTIFICATION_CATEGORIES', () => {
    expect(NOTIFICATION_CATEGORIES).toContain(PAYMENT_CATEGORY);
  });

  it('mapea los tres tipos de pago a payment_notifications', () => {
    for (const type of PAYMENT_TYPES) {
      expect(getCategoryForNotificationType(type)).toBe(PAYMENT_CATEGORY);
      expect(NOTIFICATION_TYPE_TO_CATEGORY[type]).toBe(PAYMENT_CATEGORY);
    }
  });

  it('expone metadata de UI (label, description, unlocked)', () => {
    const meta = CATEGORY_METADATA.find((item) => item.key === PAYMENT_CATEGORY);
    expect(meta).toBeDefined();
    expect(meta?.label).toBe('Pagos y comprobantes');
    expect(meta?.description.length).toBeGreaterThan(0);
    expect(meta?.locked).toBe(false);
  });

  it('no es una categoría bloqueada (la agencia puede desactivarla)', () => {
    expect(LOCKED_CATEGORIES.has(PAYMENT_CATEGORY)).toBe(false);
  });
});

describe('notification-categories — invariantes de consistencia', () => {
  it('todo tipo mapeado apunta a una categoría existente (o null)', () => {
    for (const [type, category] of Object.entries(NOTIFICATION_TYPE_TO_CATEGORY)) {
      if (category === null) continue;
      expect(
        NOTIFICATION_CATEGORIES,
        `${type} apunta a una categoría desconocida`,
      ).toContain(category);
    }
  });

  it('toda categoría tiene exactamente una entrada en CATEGORY_METADATA', () => {
    expect(CATEGORY_METADATA).toHaveLength(NOTIFICATION_CATEGORIES.length);
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(
        CATEGORY_METADATA.filter((item) => item.key === category),
      ).toHaveLength(1);
    }
  });

  it('conserva los mapeos históricos', () => {
    expect(getCategoryForNotificationType('trip_created')).toBe(
      'trip_assignments',
    );
    expect(getCategoryForNotificationType('trip_reminder')).toBe(
      'trip_reminders',
    );
    expect(getCategoryForNotificationType('occupancy_alert')).toBe(
      'occupancy_alerts',
    );
    // Sin categoría = sin gating de preferencias.
    expect(getCategoryForNotificationType('reservation_created')).toBeNull();
    expect(getCategoryForNotificationType('reservation_cancelled')).toBeNull();
    expect(getCategoryForNotificationType('passenger_cancelled')).toBeNull();
    expect(getCategoryForNotificationType('reservation_link_passenger_data')).toBeNull();
    expect(getCategoryForNotificationType('unknown_type')).toBeNull();
  });
});

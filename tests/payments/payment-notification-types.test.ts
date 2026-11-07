/**
 * PAY-NOTIFICATIONS Task 1 — contrato de la migración aditiva
 * `100_payment_notification_types.sql`.
 *
 * Bloquea tres invariantes:
 *   1. `notifications.type` solo se AMPLÍA (12 valores vigentes de
 *      069 + 3 tipos de pago); nada existente se pierde.
 *   2. `agency_notification_preferences.category` y la RPC
 *      `update_agency_notification_preferences` admiten la categoría
 *      nueva `payment_notifications` (si no, el toggle de la UI
 *      falla con ERR_PREF_CATEGORY).
 *   3. La migración NO emite notificaciones (emisión = Task 2+) y
 *      no toca entity_type ni nada destructivo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

const MIGRATION = 'supabase/migrations/100_payment_notification_types.sql';
const LEGACY_TYPE_MIGRATION = 'supabase/migrations/069_reservation_link_rpcs.sql';
const LEGACY_CATEGORY_MIGRATION = 'supabase/migrations/063_evaluate_occupancy_alerts.sql';

const NEW_PAYMENT_TYPES = [
  'payment_receipt_submitted',
  'payment_verified',
  'payment_rejected',
] as const;

const NEW_PAYMENT_CATEGORY = 'payment_notifications';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

/** Extrae los literales de un `CHECK (<col> IN (...))` creado por ADD CONSTRAINT. */
function extractCheckValues(sql: string, constraintName: string): string[] {
  const re = new RegExp(
    `ADD CONSTRAINT ${constraintName}\\s+CHECK \\(\\w+ IN \\(([\\s\\S]*?)\\)\\)`,
  );
  const match = sql.match(re);
  if (!match) {
    throw new Error(`CHECK ${constraintName} no encontrado`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Extrae el array `v_allowed TEXT[] := ARRAY[...]` de la RPC de preferencias. */
function extractAllowedCategories(sql: string): string[] {
  const match = sql.match(/v_allowed TEXT\[\] := ARRAY\[([\s\S]*?)\]/);
  if (!match) throw new Error('v_allowed no encontrado');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('100_payment_notification_types — contrato de migración', () => {
  const sql = read(MIGRATION);

  // Nota: 101 (PAY-NOTIFICATIONS Task 5) es ahora la más reciente; este
  // test ya no fija el último archivo (quedaría obsoleto con cada
  // migración nueva) sino que 100 existe y sigue la numeración.
  it('existe y sigue la numeración de 3 dígitos', () => {
    const files = fs
      .readdirSync(path.join(REPO_ROOT, 'supabase/migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(files).toContain('100_payment_notification_types.sql');
    expect(MIGRATION).toMatch(/migrations\/\d{3}_/);
  });

  it('amplía notifications_type_check con los 3 tipos de pago', () => {
    const values = extractCheckValues(sql, 'notifications_type_check');
    for (const type of NEW_PAYMENT_TYPES) {
      expect(values).toContain(type);
    }
  });

  it('preserva los 12 tipos vigentes de 069 (aditivo, nada se quita)', () => {
    const legacy = extractCheckValues(
      read(LEGACY_TYPE_MIGRATION),
      'notifications_type_check',
    );
    const next = extractCheckValues(sql, 'notifications_type_check');

    expect(legacy).toHaveLength(12);
    for (const type of legacy) {
      expect(next).toContain(type);
    }
    expect(next).toHaveLength(legacy.length + NEW_PAYMENT_TYPES.length);
  });

  it('protege la ampliación con un guard que falla ante tipos desconocidos', () => {
    expect(sql).toContain('ERR_100_NOTIFICATION_TYPE_GUARD');
    expect(sql).toContain('v_known TEXT[]');
    // El guard recorre el CHECK vigente antes de sustituirlo.
    expect(sql).toContain(
      "regexp_matches(v_current, $re$'([^']+)'$re$, 'g')",
    );
  });

  it('amplía el CHECK de categorías de preferencias con payment_notifications', () => {
    const legacy = extractCheckValues(
      read(LEGACY_CATEGORY_MIGRATION),
      'agency_notification_preferences_category_check',
    );
    const next = extractCheckValues(
      sql,
      'agency_notification_preferences_category_check',
    );

    expect(legacy).toHaveLength(7);
    for (const category of legacy) {
      expect(next).toContain(category);
    }
    expect(next).toContain(NEW_PAYMENT_CATEGORY);
    expect(next).toHaveLength(legacy.length + 1);
    expect(sql).toContain('ERR_100_PREF_CATEGORY_GUARD');
  });

  it('backfillea la preferencia para las agencias existentes', () => {
    expect(sql).toMatch(
      /INSERT INTO public\.agency_notification_preferences[\s\S]*?SELECT a\.id, 'payment_notifications', TRUE, TRUE[\s\S]*?ON CONFLICT \(agency_id, category\) DO NOTHING/,
    );
  });

  it('la RPC update_agency_notification_preferences acepta la categoría nueva', () => {
    const allowed = extractAllowedCategories(sql);
    const legacy = [
      'trip_assignments',
      'trip_schedule_changes',
      'trip_status_updates',
      'trip_cancellations',
      'trip_reminders',
      'ops_digest',
      'occupancy_alerts',
    ];
    for (const category of legacy) {
      expect(allowed).toContain(category);
    }
    expect(allowed).toContain(NEW_PAYMENT_CATEGORY);
    expect(allowed).toHaveLength(legacy.length + 1);
    // Misma firma que 065: conserva grants/owner.
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.update_agency_notification_preferences(',
    );
  });

  it('no emite notificaciones (emisión = PAY-NOTIFICATIONS Task 2+)', () => {
    expect(sql).not.toMatch(/INSERT INTO\s+public\.notifications/i);
    expect(sql).not.toMatch(/insert into\s+public\.outbox_events/i);
  });

  it('no toca entity_type, RLS ni nada destructivo', () => {
    // Puede mencionarlo en comentarios, pero nunca alterarlo.
    expect(sql).not.toMatch(
      /(DROP|ALTER|ADD) CONSTRAINT\s+notifications_entity_type_check/i,
    );
    expect(sql).not.toMatch(/DROP COLUMN|TRUNCATE|DELETE FROM/i);
    expect(sql).not.toMatch(/CREATE POLICY|DROP POLICY|ENABLE ROW LEVEL SECURITY/i);
  });

  it('las notificaciones de pago pueden usar entity_type=reservation (ya permitido)', () => {
    const legacy = read(LEGACY_TYPE_MIGRATION);
    expect(legacy).toContain("entity_type IN ('trip', 'reservation', 'passenger', 'reservation_link')");
  });
});

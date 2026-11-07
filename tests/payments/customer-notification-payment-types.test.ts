/**
 * PAY-NOTIFICATIONS Task 5 — contrato de la migración aditiva
 * `101_customer_notifications_payment_types.sql`.
 *
 * Bloquea:
 *   1. 101 es la siguiente tras 100 (numeración de 3 dígitos, orden).
 *   2. `customer_notifications.type` solo se AMPLÍA: conserva
 *      `review_pending` (único valor de 098) y agrega
 *      `payment_verified` / `payment_rejected`.
 *   3. Guard defensivo ANTES de sustituir la restricción: falla ante un
 *      tipo desconocido (migración posterior a 098 no mergeada).
 *   4. Alcance mínimo: solo el CHECK de `customer_notifications.type`;
 *      RLS, policies, GRANT/REVOKE, índices y estructura intactos.
 *   5. No emite notificaciones (emisión = tarea posterior).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

const MIGRATION = 'supabase/migrations/101_customer_notifications_payment_types.sql';
const PREVIOUS = 'supabase/migrations/100_payment_notification_types.sql';
const LEGACY_MIGRATION = 'supabase/migrations/098_review_invitations.sql';

const NEW_PAYMENT_TYPES = ['payment_verified', 'payment_rejected'];

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

/** Código SQL sin líneas de comentario (para aserciones "no toca X"). */
function code(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

/** Extrae los literales del CHECK `type IN (...)` (inline o por constraint). */
function extractTypeCheckValues(sql: string): string[] {
  const match = sql.match(/CHECK \(type IN \(([\s\S]*?)\)\)/);
  if (!match) throw new Error('CHECK (type IN (...)) no encontrado');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('101_customer_notifications_payment_types — contrato de migración', () => {
  const sql = read(MIGRATION);
  const sqlCode = code(sql);

  it('existe como archivo numerado posterior a 100 y sigue la numeración de 3 dígitos', () => {
    const files = fs
      .readdirSync(path.join(REPO_ROOT, 'supabase/migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(files).toContain('101_customer_notifications_payment_types.sql');
    expect(files.indexOf('101_customer_notifications_payment_types.sql')).toBeGreaterThan(
      files.indexOf('100_payment_notification_types.sql'),
    );
    expect(MIGRATION).toMatch(/migrations\/\d{3}_/);
  });

  it('amplía el CHECK de type con los 2 tipos de pago', () => {
    const values = extractTypeCheckValues(sql);
    for (const type of NEW_PAYMENT_TYPES) {
      expect(values).toContain(type);
    }
  });

  it('preserva review_pending de 098 (aditivo, nada se quita)', () => {
    const legacy = extractTypeCheckValues(read(LEGACY_MIGRATION));
    const next = extractTypeCheckValues(sql);

    expect(legacy).toEqual(['review_pending']);
    for (const type of legacy) {
      expect(next).toContain(type);
    }
    expect(next).toHaveLength(legacy.length + NEW_PAYMENT_TYPES.length);
  });

  it('protege la sustitución con un guard que falla ante tipos desconocidos', () => {
    expect(sqlCode).toContain('ERR_101_CUSTOMER_NOTIFICATION_TYPE_GUARD');
    expect(sqlCode).toContain('v_known TEXT[]');
    // El guard recorre el CHECK vigente ANTES de sustituirlo.
    expect(sqlCode).toContain(
      "regexp_matches(v_current, $re$'([^']+)'$re$, 'g')",
    );
    const guardAt = sqlCode.indexOf('ERR_101_CUSTOMER_NOTIFICATION_TYPE_GUARD');
    const dropAt = sqlCode.indexOf('DROP CONSTRAINT');
    expect(guardAt).toBeGreaterThan(-1);
    expect(dropAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(dropAt);
  });

  it('solo altera el CHECK de type de customer_notifications (sin tocar otras constraints)', () => {
    const alters = [...sqlCode.matchAll(/ALTER TABLE\s+([\w.]+)/g)].map((m) => m[1]);
    expect(alters).toHaveLength(2);
    for (const target of alters) {
      expect(target).toBe('public.customer_notifications');
    }

    const drops = [...sqlCode.matchAll(/DROP CONSTRAINT(?:\s+IF EXISTS)?\s+([\w_]+)/g)].map(
      (m) => m[1],
    );
    expect(drops).toEqual(['customer_notifications_type_check']);
    expect(sqlCode).toContain(
      'ADD CONSTRAINT customer_notifications_type_check',
    );
  });

  it('no toca RLS, policies, grants, índices ni la estructura de la tabla', () => {
    // Sin sentencias de permisos, seguridad, índices ni estructura.
    expect(sqlCode).not.toMatch(/\bGRANT\b/);
    expect(sqlCode).not.toMatch(/\bREVOKE\b/);
    expect(sqlCode).not.toMatch(/CREATE POLICY|DROP POLICY/);
    expect(sqlCode).not.toMatch(/ENABLE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY/);
    expect(sqlCode).not.toMatch(/CREATE INDEX|DROP INDEX/);
    expect(sqlCode).not.toMatch(/DROP TABLE|TRUNCATE/i);
    expect(sqlCode).not.toMatch(/DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+public\./i);
    expect(sqlCode).not.toMatch(/CREATE OR REPLACE FUNCTION/);
    // Ni columnas: entity_type y el resto de la tabla quedan como en 098.
    expect(sqlCode).not.toContain('entity_type');
    expect(sqlCode).not.toContain('read_at');

    // 098 sigue definiendo RLS + policies + grants + índice (101 no los
    // replica porque no los toca: se preservan tal cual).
    const legacy = read(LEGACY_MIGRATION);
    expect(legacy).toContain(
      'ALTER TABLE public.customer_notifications ENABLE ROW LEVEL SECURITY',
    );
    expect(legacy).toContain('idx_customer_notifications_customer');
    expect(legacy).toContain('customer_notifications_customer_read');
    expect(legacy).toContain('customer_notifications_customer_update');
    expect(legacy).toContain('customer_notifications_superadmin_read');
    expect(legacy).toContain(
      'GRANT UPDATE (read_at) ON TABLE public.customer_notifications TO authenticated',
    );
    expect(legacy).toContain(
      'REVOKE ALL ON TABLE public.customer_notifications FROM PUBLIC',
    );
  });

  it('no emite notificaciones ni crea funciones (emisión = tarea posterior)', () => {
    expect(sqlCode).not.toMatch(/INSERT\s+INTO/i);
    expect(sqlCode).not.toMatch(/pg_notify|notify\(/i);
    expect(sqlCode).not.toMatch(/CREATE OR REPLACE FUNCTION/i);
    expect(sqlCode).not.toContain('payment_receipt_submitted');
  });

  it('documenta el alcance aditivo con COMMENT en la restricción', () => {
    expect(sqlCode).toContain(
      'COMMENT ON CONSTRAINT customer_notifications_type_check ON public.customer_notifications',
    );
    expect(sqlCode).toContain('Aditivo: no quitar valores.');
  });
});

/**
 * @vitest-environment node
 *
 * MKT-010 — contratos estaticos del ciclo de vida de expiracion del
 * checkout (migracion 087). Estas pruebas leen el TEXTO de la migracion;
 * son contratos de regresion, NO ejercitan PostgreSQL. Verifican que la
 * RPC `cleanup_expired_checkout_attempts` y sus RPCs vecinas conservan
 * las invariantes que el invocador de aplicacion (backend marketplace,
 * backend tour, edge function) presupone:
 *
 *  1. El cleanup cierra UNICAMENTE intentos abiertos con ventana vencida.
 *  2. Libera UNICAMENTE locks propios (`checkout_attempt_id` del intento).
 *  3. Es idempotente y deadlock-safe (SKIP LOCKED + guards de fila).
 *  4. El envio de comprobante rechaza la ventana vencida y re-fija +24 h.
 *  5. La creacion hereda el TTL restante de los locks (nunca un TTL del
 *     cliente): Marketplace 900 s / Tour 600 s no se tocan aqui.
 *  6. La cancelacion tambien acota la liberacion por intento.
 *  7. No depende de pg_cron (prohibido por f4_003).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const MIGRATION_087 = 'supabase/migrations/087_checkout_attempts.sql';

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

/** Extrae el cuerpo de CREATE OR REPLACE FUNCTION public.<name>( ... $$. */
function extractFunction(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('$$;', start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end + 3);
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

const sql087 = readRepoFile(MIGRATION_087);
const cleanupBody = normalizeSql(
  extractFunction(sql087, 'cleanup_expired_checkout_attempts'),
);
const submitBody = normalizeSql(extractFunction(sql087, 'submit_checkout_proof'));
const createBody = normalizeSql(extractFunction(sql087, 'create_checkout_attempt'));
const cancelBody = normalizeSql(extractFunction(sql087, 'cancel_checkout_attempt'));

describe('MKT-010 — cleanup_expired_checkout_attempts (087)', () => {
  it('existe, es SECURITY DEFINER sin parametros y solo service_role la ejecuta', () => {
    expect(sql087).toMatch(
      /CREATE OR REPLACE FUNCTION public\.cleanup_expired_checkout_attempts\(\)/,
    );
    expect(cleanupBody).toContain('SECURITY DEFINER');
    expect(cleanupBody).toContain('SET search_path = public');
    expect(sql087).toMatch(
      /REVOKE ALL ON FUNCTION public\.cleanup_expired_checkout_attempts\(\) FROM PUBLIC;/,
    );
    expect(sql087).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.cleanup_expired_checkout_attempts\(\) TO service_role;/,
    );
  });

  it('solo cierra intentos ABIERTOS cuya ventana ya venció (BD = autoridad del tiempo)', () => {
    expect(cleanupBody).toContain(
      "WHERE ca.status IN ('created', 'pending_review', 'rejected') AND ca.expires_at <= NOW()",
    );
    // Nunca toca estados terminales (verified/rejected_final/cancelled) ni
    // ventana futura: una compra en revisión conserva sus locks hasta +24 h.
    expect(cleanupBody).not.toMatch(
      /status IN \('created', 'pending_review', 'rejected', 'verified'\)/,
    );
  });

  it('libera SOLO los locks que pertenecen al intento vencido (aislamiento)', () => {
    expect(cleanupBody).toContain(
      "WHERE s.checkout_attempt_id = v_attempt.id AND s.status = 'locked'",
    );
    // El cierre se acota por id y repite las condiciones de seleccion
    // (guard de carrera contra verify/reject/cancel).
    expect(cleanupBody).toContain(
      "WHERE ca.id = v_attempt.id AND ca.status IN ('created', 'pending_review', 'rejected')",
    );
  });

  it('es idempotente y deadlock-safe: SKIP LOCKED + lote acotado', () => {
    expect(cleanupBody).toContain('FOR UPDATE SKIP LOCKED');
    expect(cleanupBody).toContain('LIMIT 200');
    expect(cleanupBody).toContain("'expired'");
    expect(cleanupBody).toContain('closed_at = NOW()');
    expect(cleanupBody).toContain("audit_append");
    expect(cleanupBody).toContain("'checkout.expired'");
  });

  it('devuelve el recuento para el invocador (expired / freed_seats / attempt_ids)', () => {
    expect(cleanupBody).toContain("'expired', v_expired");
    expect(cleanupBody).toContain("'freed_seats', v_freed_total");
    expect(cleanupBody).toContain("'attempt_ids', to_jsonb(v_ids)");
  });

  it('no depende de pg_cron ni de schedules dentro de la migracion', () => {
    expect(sql087).not.toMatch(/pg_cron/i);
    expect(sql087).not.toMatch(/cron\.schedule/i);
  });
});

describe('MKT-010 — submit_checkout_proof (087): ventana del checkout completo', () => {
  it('rechaza el comprobante cuando la ventana ya venció', () => {
    expect(submitBody).toContain(
      "RAISE EXCEPTION 'ERR_CHECKOUT_WINDOW_EXPIRED: The checkout window has expired'",
    );
    expect(submitBody).toContain('IF v_attempt.expires_at <= NOW() THEN');
  });

  it('re-fija la ventana a +24 h desde el envío y prolonga los locks a la par', () => {
    expect(submitBody).toContain("v_new_expires := NOW() + interval '24 hours'");
    expect(submitBody).toContain(
      'UPDATE public.seats s SET lock_expires_at = v_new_expires',
    );
  });

  it('serializa el envío con FOR UPDATE sobre el intento (atomicidad)', () => {
    expect(submitBody).toMatch(
      /INTO v_attempt\s+FROM public\.checkout_attempts ca\s+WHERE ca\.id = p_attempt_id\s+FOR UPDATE/,
    );
  });
});

describe('MKT-010 — create_checkout_attempt (087): el plazo nace en el servidor', () => {
  it('la ventana inicial hereda el menor lock_expires_at (nunca un TTL del cliente)', () => {
    expect(createBody).toContain('v_seat.lock_expires_at');
    expect(createBody).toMatch(
      /IF v_expires_at IS NULL OR v_seat\.lock_expires_at < v_expires_at THEN/,
    );
    expect(createBody).not.toMatch(/p_ttl/i);
    expect(createBody).not.toContain('ttl_seconds');
    expect(createBody).not.toMatch(/INTERVAL\s+'(600|900)\s*seconds?'/i);
  });

  it('marca los asientos del intento en la misma transacción (checkout_attempt_id)', () => {
    expect(createBody).toContain('checkout_attempt_id = v_attempt_id');
    expect(createBody).toContain('ROW_COUNT');
  });
});

describe('MKT-010 — cancel_checkout_attempt (087): cancelar también acota por intento', () => {
  it('libera solo locks del intento y bloquea terminales', () => {
    expect(cancelBody).toContain(
      "WHERE s.checkout_attempt_id = p_attempt_id AND s.status = 'locked'",
    );
    expect(cancelBody).toContain(
      "IF v_attempt.status IN ('rejected_final', 'expired') THEN",
    );
  });
});

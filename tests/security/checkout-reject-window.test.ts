/**
 * @vitest-environment node
 *
 * MKT-007 / Opcion A — contratos estaticos de la migracion 090
 * (rechazo despues del vencimiento de la ventana).
 *
 * Estas pruebas leen el TEXTO de las migraciones y del rollback; son
 * contratos estaticos de regresion, NO ejercutan PostgreSQL. La
 * validacion de comportamiento real (estados, locks, auditoria,
 * carreras) requiere los escenarios de integracion documentados en el
 * header de 090_checkout_reject_after_window.sql.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

const MIGRATION_087 = 'supabase/migrations/087_checkout_attempts.sql';
const MIGRATION_090 = 'supabase/migrations/090_checkout_reject_after_window.sql';
const ROLLBACK_090 = 'supabase/rollbacks/090_checkout_reject_after_window_rollback.sql';

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

/** Extrae el cuerpo de CREATE OR REPLACE FUNCTION ... $$; de reject_checkout_attempt. */
function extractRejectFunction(sql: string): string {
  const start = sql.indexOf(
    'CREATE OR REPLACE FUNCTION public.reject_checkout_attempt(',
  );
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('$$;', start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end + 3);
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

const sql087 = readRepoFile(MIGRATION_087);
const sql090 = readRepoFile(MIGRATION_090);
const sqlRollback = readRepoFile(ROLLBACK_090);
const body090 = extractRejectFunction(sql090);

describe('MKT-007 Opcion A — migracion 090: rechazo tras vencimiento', () => {
  it('define reject_checkout_attempt con la firma compatible con 087', () => {
    const signature =
      /CREATE OR REPLACE FUNCTION public\.reject_checkout_attempt\(\s*p_attempt_id UUID,\s*p_actor_user_id UUID,\s*p_reason TEXT\s*\)/;
    expect(sql090).toMatch(signature);
    expect(sql090).toMatch(/RETURNS JSONB/);
    expect(sql090).toMatch(/SECURITY DEFINER/);
    expect(sql090).toMatch(/SET search_path = public/);
  });

  it('090 redefine unicamente reject_checkout_attempt (sin otras RPC)', () => {
    const creates = sql090.match(
      /CREATE OR REPLACE FUNCTION public\.[a-z_]+/g,
    );
    expect(creates).toEqual([
      'CREATE OR REPLACE FUNCTION public.reject_checkout_attempt',
    ]);
    expect(sql090).not.toContain('verify_checkout_attempt(');
    expect(sql090).not.toContain('submit_checkout_proof(');
    expect(sql090).not.toContain('cancel_checkout_attempt(');
    expect(sql090).not.toContain('cleanup_expired_checkout_attempts(');
  });

  it('090 elimina el guard ERR_CHECKOUT_WINDOW_EXPIRED de la ruta de rechazo', () => {
    expect(body090).not.toContain('ERR_CHECKOUT_WINDOW_EXPIRED');
    expect(body090).toContain(
      'v_window_expired := v_attempt.expires_at <= NOW();',
    );
    expect(body090).toContain(
      'IF v_window_expired OR v_attempt.proof_count >= 3 THEN',
    );
    expect(body090).not.toMatch(
      /IF v_attempt\.expires_at <= NOW\(\) THEN\s*RAISE EXCEPTION/,
    );
  });

  it('087 conserva el guard de vencimiento de verify_checkout_attempt', () => {
    const occurrences = sql087.match(/ERR_CHECKOUT_WINDOW_EXPIRED/g) ?? [];
    expect(occurrences.length).toBe(3);
    const verifyStart = sql087.indexOf(
      'CREATE OR REPLACE FUNCTION public.verify_checkout_attempt(',
    );
    const rejectStart = sql087.indexOf(
      'CREATE OR REPLACE FUNCTION public.reject_checkout_attempt(',
    );
    expect(verifyStart).toBeGreaterThanOrEqual(0);
    expect(rejectStart).toBeGreaterThan(verifyStart);
    const verifyBody = sql087.slice(verifyStart, rejectStart);
    expect(verifyBody).toContain('ERR_CHECKOUT_WINDOW_EXPIRED');
    expect(verifyBody).toContain(
      "RAISE EXCEPTION 'ERR_CHECKOUT_WINDOW_EXPIRED: The review window has expired';",
    );
  });

  it('090 no toca estados, tablas, triggers, indices ni TTLs de locks', () => {
    expect(sql090).not.toMatch(/CREATE TABLE/i);
    expect(sql090).not.toMatch(/ALTER TABLE/i);
    expect(sql090).not.toMatch(/CREATE TRIGGER|DROP TRIGGER/i);
    expect(sql090).not.toMatch(/CREATE INDEX|DROP INDEX/i);
    expect(body090).not.toMatch(/CHECK \(status IN/i);
    expect(body090).not.toContain('ca_expired_emit_outbox_t');
    expect(body090).not.toContain('trg_seats_clear_checkout_attempt');
    expect(body090).not.toMatch(/INTERVAL\s+'(600|900)\s*seconds?'/i);
    expect(body090).not.toContain('LOCK_TTL');
  });

  it('090 conserva autorizacion, ownership, idempotencia, concurrencia y auditoria', () => {
    expect(sql090).toContain('FOR UPDATE');
    expect(sql090).toContain('ERR_CHECKOUT_ADMIN_ROLE');
    expect(sql090).toContain('ERR_CHECKOUT_AGENCY_MISMATCH');
    expect(sql090).toContain("ERR_CHECKOUT_ALREADY_VERIFIED");
    expect(sql090).toContain("'already_rejected', true");
    expect(sql090).toContain('ERR_CHECKOUT_RACE');
    expect(sql090).toContain("ERR_CHECKOUT_ATTEMPT_CLOSED");
    expect(sql090).toContain('ERR_CHECKOUT_NO_PROOF');
    expect(sql090).toContain('ERR_CHECKOUT_NOT_PENDING');
    expect(sql090).toContain('ERR_CHECKOUT_REJECT_REASON');
    expect(sql090).toContain("public.audit_append(");
    expect(sql090).toContain("'checkout.rejected'");
    expect(sql090).toContain("AND s.status = 'locked'");
    expect(sql090).toContain('s.checkout_attempt_id = p_attempt_id');
  });

  it('090 añade window_expired a respuesta, historial y auditoria', () => {
    const occurrences = sql090.match(/'window_expired', v_window_expired/g) ?? [];
    expect(occurrences.length).toBe(3);
    expect(sql090).toContain('v_window_expired BOOLEAN := false;');
    expect(sql090).toMatch(
      /history = ca\.history \|\| jsonb_build_array\(jsonb_build_object\([\s\S]*?'window_expired', v_window_expired/,
    );
    expect(sql090).toMatch(
      /audit_append\([\s\S]*?jsonb_build_object\([\s\S]*?'window_expired', v_window_expired/,
    );
    expect(sql090).toMatch(
      /RETURN jsonb_build_object\([\s\S]*?'window_expired', v_window_expired/,
    );
  });

  it('090 reemite privilegios service_role y REVOKE a roles publicos', () => {
    expect(sql090).toContain(
      'REVOKE ALL ON FUNCTION public.reject_checkout_attempt(UUID, UUID, TEXT) FROM PUBLIC;',
    );
    expect(sql090).toContain(
      'REVOKE ALL ON FUNCTION public.reject_checkout_attempt(UUID, UUID, TEXT) FROM anon;',
    );
    expect(sql090).toContain(
      'REVOKE ALL ON FUNCTION public.reject_checkout_attempt(UUID, UUID, TEXT) FROM authenticated;',
    );
    expect(sql090).toContain(
      'GRANT EXECUTE ON FUNCTION public.reject_checkout_attempt(UUID, UUID, TEXT) TO service_role;',
    );
  });

  it('el rollback restaura identicamente el cuerpo de rechazo de 087', () => {
    const body087 = normalizeSql(extractRejectFunction(sql087));
    const bodyRollback = normalizeSql(extractRejectFunction(sqlRollback));
    expect(bodyRollback).toBe(body087);
  });

  it('el rollback reintegra el guard de vencimiento y el v_final previo', () => {
    expect(sqlRollback).toContain(
      "RAISE EXCEPTION 'ERR_CHECKOUT_WINDOW_EXPIRED: The review window has expired';",
    );
    expect(sqlRollback).toContain('IF v_attempt.proof_count >= 3 THEN');
    expect(sqlRollback).not.toContain('v_window_expired');
    expect(sqlRollback).not.toContain("'window_expired'");
  });

  it('el rollback vive fuera de supabase/migrations y documenta que no revierte datos', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, ROLLBACK_090))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, MIGRATION_090))).toBe(true);
    expect(sqlRollback).toMatch(/NO revierte datos/i);
  });

  it('087 sigue existiendo intacta como fuente historica (no fue reescrita)', () => {
    expect(sql087).toContain(
      "-- 4) La ventana la cierra el cleanup, no el rechazo. Si ya vencio",
    );
    expect(sql087).toContain(
      'CREATE OR REPLACE FUNCTION public.cleanup_expired_checkout_attempts()',
    );
  });
});

/**
 * @vitest-environment node
 *
 * AS-TRIP-004 — contratos estaticos de la migracion 105
 * (edicion de viajes propios por la agencia via update_agency_trip).
 *
 * Estas pruebas leen el TEXTO de la migracion y del rollback; son
 * contratos estaticos de regresion, NO ejercitan PostgreSQL. La
 * validacion de comportamiento real (locks, carreras reserva-vs-edicion,
 * autorizacion en BD) requiere los escenarios de integracion
 * documentados en el header de 105_agency_trip_update.sql.
 *
 * Motivo de la migracion (atomicidad, no autorizacion delegada):
 * la guarda "cero reservas" debe correr en la MISMA transaccion que el
 * UPDATE, bajo FOR UPDATE de la fila del viaje, para cerrar la ventana
 * en la que una reserva concurrente se coloca entre el chequeo de la capa
 * de servicio y la escritura. El trigger 104 toma FOR SHARE en cada
 * INSERT de reserva, asi que la carrera queda serializada.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

const MIGRATION_105 = 'supabase/migrations/105_agency_trip_update.sql';
const MIGRATION_104 = 'supabase/migrations/104_trip_status_authorization.sql';
const MIGRATION_084 = 'supabase/migrations/084_trip_seat_price.sql';
const ROLLBACK_105 = 'supabase/rollbacks/105_agency_trip_update_rollback.sql';

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

/** Extrae el cuerpo de CREATE OR REPLACE FUNCTION ... $$; de la funcion. */
function extractFunction(sql: string, signature: string): string {
  const start = sql.indexOf(signature);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('$$;', start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end + 3);
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

const sql105 = readRepoFile(MIGRATION_105);
const sql104 = readRepoFile(MIGRATION_104);
const sql084 = readRepoFile(MIGRATION_084);
const sqlRollback = readRepoFile(ROLLBACK_105);
const body105 = normalizeSql(
  extractFunction(
    sql105,
    'CREATE OR REPLACE FUNCTION public.update_agency_trip(',
  ),
);

/** Quita comentarios SQL para que los checks no se confundan con docs. */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const code105 = stripSqlComments(sql105);
const codeRollback = stripSqlComments(sqlRollback);

describe('AS-TRIP-004 — migracion 105: update_agency_trip', () => {
  it('define update_agency_trip con la firma esperada (SIN parametro de agencia)', () => {
    const signature =
      /CREATE OR REPLACE FUNCTION public\.update_agency_trip\(\s*p_trip_id UUID,\s*p_route_id UUID,\s*p_departure_time TIMESTAMPTZ,\s*p_vehicle_type TEXT,\s*p_actor_user_id UUID,\s*p_seat_price INTEGER DEFAULT NULL\s*\)/;
    expect(sql105).toMatch(signature);
    expect(sql105).toMatch(/RETURNS JSONB/);
    expect(sql105).toMatch(/SECURITY DEFINER/);
    expect(sql105).toMatch(/SET search_path = public/);

    // La agencia NUNCA es un parametro: se resuelve desde public.users.
    expect(sql105).not.toMatch(/p_agency_id|p_agency_ids/);
    // Tampoco se acepta un rol declarado por el cliente.
    expect(sql105).not.toMatch(/p_role|p_is_superadmin/);
  });

  it('105 crea unicamente update_agency_trip (sin otras RPC)', () => {
    const creates = sql105.match(/CREATE OR REPLACE FUNCTION public\.[a-z_]+/g);
    expect(creates).toEqual(['CREATE OR REPLACE FUNCTION public.update_agency_trip']);
    expect(code105).not.toContain('CREATE OR REPLACE FUNCTION public.update_trip(');
    expect(code105).not.toContain('set_trip_status');
    expect(code105).not.toContain('create_trip(');
  });

  it('el rol y la agencia del actor se leen de public.users (nunca del cliente)', () => {
    expect(body105).toContain(
      "SELECT * INTO v_actor FROM public.users WHERE id = p_actor_user_id;",
    );
    expect(body105).toContain("IF v_actor.role <> 'agency' THEN");
    expect(body105).toContain('IF v_actor.agency_id IS NULL THEN');
    // Sin actor no hay edicion: no se infiere identidad.
    expect(body105).toContain("RAISE EXCEPTION 'ERR_ACTOR_REQUIRED");
  });

  it('toma FOR UPDATE sobre el viaje ANTES de cualquier guarda de negocio', () => {
    const lockIndex = body105.indexOf('FROM trips WHERE id = p_trip_id FOR UPDATE');
    expect(lockIndex).toBeGreaterThan(0);

    const order: Array<[string, number]> = [
      // Lock primero…
      ['ERR_TRIP_NOT_FOUND', body105.indexOf('ERR_TRIP_NOT_FOUND')],
      // …luego estado, exclusividad y reservas, todos bajo el lock.
      ['ERR_TRIP_NOT_ACTIVE', body105.indexOf('ERR_TRIP_NOT_ACTIVE')],
      ['ERR_TRIP_NOT_EXCLUSIVE', body105.indexOf('ERR_TRIP_NOT_EXCLUSIVE')],
      ['ERR_TRIP_HAS_RESERVATIONS', body105.indexOf('ERR_TRIP_HAS_RESERVATIONS')],
      ['ERR_ROUTE_NOT_FOUND', body105.indexOf('ERR_ROUTE_NOT_FOUND')],
      ['ERR_DEPARTURE_NOT_FUTURE', body105.indexOf('ERR_DEPARTURE_NOT_FUTURE')],
      ['public.update_trip(', body105.indexOf('RETURN public.update_trip(')],
    ];
    for (const [label, index] of order) {
      expect(index, `${label} debe aparecer despues del FOR UPDATE`).toBeGreaterThan(
        lockIndex,
      );
    }
    // Y en ese orden exacto.
    const sorted = [...order.map(([, index]) => index)];
    expect(sorted).toEqual([...sorted].sort((a, b) => a - b));
  });

  it('la guarda de reservas cuenta TODAS las reservas, sin filtro de status', () => {
    expect(body105).toMatch(
      /SELECT count\(\*\) INTO v_reservation_count\s+FROM reservations\s+WHERE trip_id = p_trip_id;/,
    );
    // Ninguna clausula de status: canceladas tambien bloquean.
    expect(body105).not.toMatch(/FROM reservations[\s\S]{0,120}status\s*=/);
    expect(body105).toContain('ERR_TRIP_HAS_RESERVATIONS');
    // La guarda esta ANTES del UPDATE (delegado en update_trip).
    expect(body105.indexOf('ERR_TRIP_HAS_RESERVATIONS')).toBeLessThan(
      body105.indexOf('RETURN public.update_trip('),
    );
  });

  it('exige UNA sola asignacion y que sea la del actor (viajes compartidos y ajenos fuera)', () => {
    expect(body105).toContain('FROM trip_agencies');
    expect(body105).toContain('WHERE trip_id = p_trip_id');
    expect(body105).toMatch(
      /IF array_length\(v_agency_ids, 1\) IS DISTINCT FROM 1/,
    );
    expect(body105).toMatch(
      /OR v_agency_ids\[1\] IS DISTINCT FROM v_actor\.agency_id THEN/,
    );
    expect(body105).toContain('ERR_TRIP_NOT_EXCLUSIVE');
    // Solo viajes activos (ni completed, ni cancelled, ni archived).
    expect(body105).toContain("IF v_trip.status <> 'active' THEN");
  });

  it('la ruta debe existir y estar activa; la salida debe permanecer en el futuro', () => {
    expect(body105).toContain('SELECT * INTO v_route FROM routes WHERE id = p_route_id;');
    expect(body105).toContain("IF v_route.status <> 'active' THEN");
    expect(body105).toContain('ERR_ROUTE_INACTIVE');
    expect(body105).toContain('IF p_departure_time <= NOW() THEN');
    expect(body105).toContain('ERR_DEPARTURE_NOT_FUTURE');
  });

  it('delega en update_trip con la asignacion IDENTICA y p_postpone=FALSE', () => {
    // La agencia no cambia: se pasa la del actor como unica asignacion.
    expect(body105).toMatch(
      /ARRAY\[v_actor\.agency_id\],\s*FALSE,\s*p_actor_user_id,\s*p_seat_price\s*\);/,
    );
    // Nunca se reescribe trip_agencies desde esta RPC.
    expect(body105).not.toMatch(/(INSERT|UPDATE|DELETE)\s+INTO\s+trip_agencies|DELETE\s+FROM\s+trip_agencies/i);
    // Nunca toca postponed_from ni estados: no hay set_trip_status aqui.
    expect(body105).not.toContain('postponed_from');
    expect(body105).not.toMatch(/UPDATE trips\s+SET\s+status/i);
    expect(sql105).not.toMatch(/UPDATE\s+trips\s+SET\s+status/i);
  });

  it('no toca tablas, columnas, triggers, indices ni politicas RLS', () => {
    expect(sql105).not.toMatch(/CREATE TABLE/i);
    expect(sql105).not.toMatch(/ALTER TABLE/i);
    expect(sql105).not.toMatch(/CREATE TRIGGER|DROP TRIGGER/i);
    expect(sql105).not.toMatch(/CREATE INDEX|DROP INDEX/i);
    expect(sql105).not.toMatch(/CREATE POLICY|DROP POLICY|ENABLE ROW LEVEL/i);
    expect(sql105).not.toMatch(/user_metadata/);
    expect(sql105).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE)/i);
  });

  it('reemite privilegios: EXECUTE solo service_role', () => {
    const fn =
      'public.update_agency_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID, INTEGER)';
    expect(sql105).toContain(`REVOKE EXECUTE ON FUNCTION ${fn} FROM PUBLIC;`);
    expect(sql105).toContain(`REVOKE EXECUTE ON FUNCTION ${fn} FROM anon;`);
    expect(sql105).toContain(`REVOKE EXECUTE ON FUNCTION ${fn} FROM authenticated;`);
    expect(sql105).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO service_role;`);
  });

  it('documenta por que la migracion es NECESARIA (atomicidad de la guarda de reservas)', () => {
    expect(sql105).toMatch(/MISMA transaccion/);
    expect(sql105).toMatch(/FOR SHARE/);
    expect(sql105).toContain('104');
    // Serializacion explicita con el trigger de reservas de 104.
    expect(sql104).toContain('FOR SHARE');
    expect(sql104).toContain('reservations_trip_status_guard');
    // update_trip (084) sigue existiendo intacta como destino de delegacion.
    expect(sql084).toContain(
      'CREATE OR REPLACE FUNCTION public.update_trip(',
    );
    expect(normalizeSql(sql084)).toContain('p_seat_price INTEGER DEFAULT NULL');
  });

  it('el rollback vive fuera de supabase/migrations y solo dropea la funcion nueva', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, ROLLBACK_105))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, MIGRATION_105))).toBe(true);
    expect(sqlRollback).toContain(
      'DROP FUNCTION IF EXISTS public.update_agency_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID, INTEGER);',
    );
    // Solo esa sentencia DDL: no toca update_trip, set_trip_status ni el
    // trigger de reservas de 104 (comentarios aparte).
    expect(codeRollback).not.toContain('update_trip(');
    expect(codeRollback).not.toContain('set_trip_status');
    expect(codeRollback).not.toContain('DROP TRIGGER');
    expect(codeRollback.trim()).toMatch(
      /^DROP FUNCTION IF EXISTS public\.update_agency_trip\(UUID, UUID, TIMESTAMPTZ, TEXT, UUID, INTEGER\);$/,
    );
    expect(sqlRollback).toMatch(/rollback MANUAL/i);
  });
});

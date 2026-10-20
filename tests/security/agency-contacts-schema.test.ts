/**
 * @vitest-environment node
 *
 * MKT-008 — contratos estaticos de la migracion 091
 * (agency_contacts: contactos de agencia, formato de telefono del
 * sistema, RLS deny-by-default).
 *
 * Estas pruebas leen el TEXTO de la migracion y del rollback; son
 * contratos estaticos de regresion, NO ejercitan PostgreSQL. El
 * comportamiento real (RLS, ownership, duplicados, carreras) requiere
 * validacion en staging con la migracion aplicada.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

const MIGRATION_091 = 'supabase/migrations/091_agency_contacts.sql';
const ROLLBACK_091 = 'supabase/rollbacks/091_agency_contacts_rollback.sql';

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

const sql091 = readRepoFile(MIGRATION_091);
const sqlRollback = readRepoFile(ROLLBACK_091);

// Codigo sin comentarios de cabecera: para aserciones de "no toca X"
// (la cabecera-documentacion puede mencionar tablas/errores ajenos).
const sql091Code = sql091
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('MKT-008 — migracion 091: agency_contacts', () => {
  it('define la tabla con el esquema minimo, formato del sistema y sin is_primary ni email', () => {
    expect(sql091).toContain('CREATE TABLE public.agency_contacts (');
    expect(sql091).toMatch(
      /agency_id UUID NOT NULL REFERENCES public\.agencies\(id\) ON DELETE CASCADE/,
    );
    expect(sql091).toMatch(/label TEXT NOT NULL CHECK \(char_length\(label\) BETWEEN 1 AND 60\)/);
    // Formato del resto del sistema: 11 digitos o + y 12 digitos.
    expect(sql091).toMatch(
      /phone TEXT NOT NULL CHECK \(phone ~ '\^\(\[0-9\]\{11\}\|\\\+\[0-9\]\{12\}\)\$'\)/,
    );
    expect(sql091).toMatch(
      /channel TEXT NOT NULL CHECK \(channel IN \('call', 'whatsapp'\)\)/,
    );
    expect(sql091).toContain('is_active BOOLEAN NOT NULL DEFAULT true');
    expect(sql091).toContain('is_public BOOLEAN NOT NULL DEFAULT false');
    expect(sql091).toContain('sort_order INTEGER NOT NULL DEFAULT 0');
    expect(sql091).toContain('deleted_at TIMESTAMPTZ');
    expect(sql091).not.toMatch(/is_primary/);
    expect(sql091).not.toMatch(/CREATE TABLE public\.agency_contacts[\s\S]*?email/i);
  });

  it('crea indice unico parcial de duplicados y indice de listado por agencia', () => {
    expect(sql091).toMatch(
      /CREATE UNIQUE INDEX uq_agency_contacts_phone\s+ON public\.agency_contacts \(agency_id, phone\)\s+WHERE deleted_at IS NULL/,
    );
    expect(sql091).toMatch(
      /CREATE INDEX idx_agency_contacts_agency\s+ON public\.agency_contacts \(agency_id, is_active, is_public, sort_order, created_at\)\s+WHERE deleted_at IS NULL/,
    );
  });

  it('habilita RLS con deny-by-default y acceso solo via service_role', () => {
    expect(sql091).toContain('ALTER TABLE public.agency_contacts ENABLE ROW LEVEL SECURITY');
    expect(sql091).toContain('REVOKE ALL ON TABLE public.agency_contacts FROM PUBLIC');
    expect(sql091).toContain('REVOKE ALL ON TABLE public.agency_contacts FROM anon');
    expect(sql091).toContain('REVOKE ALL ON TABLE public.agency_contacts FROM authenticated');
    expect(sql091).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agency_contacts TO service_role',
    );
    expect(sql091).not.toMatch(/CREATE POLICY[\s\S]*?agency_contacts[\s\S]*?FOR SELECT[\s\S]*?anon/);
    expect(sql091).not.toMatch(/CREATE POLICY/);
  });

  it('define el validador del formato del sistema sin conversion 0...->58...', () => {
    expect(sql091).toContain(
      'CREATE OR REPLACE FUNCTION public.agency_contact_normalize_phone(',
    );
    expect(sql091).toMatch(/v !~ '\^\(\[0-9\]\{11\}\|\\\+\[0-9\]\{12\}\)\$'/);
    // Mismo strip que PHONE_STRIP_RE de validateForm.ts.
    expect(sql091).toContain("v := regexp_replace(v, '[\\s\\-]', '', 'g');");
    // Prohibido asumir prefijo venezolano (0 -> 58) o prefijo 00 -> +.
    expect(sql091).not.toContain("IF v LIKE '00%' THEN");
    expect(sql091).not.toContain("'58'");
    expect(sql091).not.toMatch(/58\$\{digits/);
    expect(sql091).toContain('ERR_CONTACT_DATA');
  });

  it('define las 3 RPCs con SECURITY DEFINER, search_path y grants solo service_role', () => {
    const signatures = [
      'public.create_agency_contact(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER)',
      'public.update_agency_contact(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, BOOLEAN)',
      'public.delete_agency_contact(UUID, UUID, UUID)',
    ];
    for (const signature of signatures) {
      // La firma de CREATE va multilina (parametros en renglones propios);
      // los grants/revokes usan la firma compacta en una sola linea.
      const fnName = signature.slice(0, signature.indexOf('('));
      expect(sql091).toContain(`CREATE OR REPLACE FUNCTION ${fnName}(`);
      expect(sql091).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`);
      expect(sql091).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM anon`);
      expect(sql091).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM authenticated`);
      expect(sql091).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role`);
    }
    const definerCount = (sql091.match(/^\s*SECURITY DEFINER\s*$/gm) ?? []).length;
    expect(definerCount).toBe(3);
    const searchPathCount = (sql091.match(/SET search_path = public/g) ?? []).length;
    expect(searchPathCount).toBe(3);
  });

  it('valida actor y ownership contra public.users; nunca usa user_metadata', () => {
    const ownershipCount = (
      sql091.match(/v_actor\.agency_id IS DISTINCT FROM p_agency_id/g) ?? []
    ).length;
    expect(ownershipCount).toBe(3);
    expect(sql091).toContain("v_actor.role IS DISTINCT FROM 'agency'");
    expect(sql091).toContain('FROM public.users u');
    expect(sql091).not.toContain('user_metadata');
    expect(sql091).not.toContain('auth.jwt()');
  });

  it('prohibe cambiar agency_id y bloquea duplicados vivos', () => {
    // update_agency_contact no acepta ni escribe un nuevo agency_id.
    const updateStart = sql091.indexOf('CREATE OR REPLACE FUNCTION public.update_agency_contact(');
    const updateEnd = sql091.indexOf('$$;', updateStart);
    const updateBody = sql091.slice(updateStart, updateEnd);
    const setStart = updateBody.indexOf('SET label =');
    const setEnd = updateBody.indexOf('WHERE', setStart);
    const setBlock = updateBody.slice(setStart, setEnd);
    expect(setBlock).not.toMatch(/agency_id\s*=/);
    expect(sql091).toContain("EXCEPTION WHEN unique_violation THEN");
    // Solo los RAISE (los COMMENT ON FUNCTION tambien mencionan el codigo).
    expect((sql091.match(/RAISE EXCEPTION 'ERR_CONTACT_DUPLICATE/g) ?? []).length).toBe(2);
    expect(
      (sql091.match(/RAISE EXCEPTION 'ERR_CONTACT_NOT_FOUND/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('audita cada mutacion con acciones y entidad agency_contact', () => {
    expect((sql091.match(/public\.audit_append\(/g) ?? []).length).toBe(3);
    expect(sql091).toContain("'agency_contact.created'");
    expect(sql091).toContain("'agency_contact.updated'");
    expect(sql091).toContain("'agency_contact.deleted'");
    expect(sql091).toContain("'agency_contact'");
    expect(sql091).toContain("'agency'");
  });

  it('no toca reservas, asientos, checkout attempts, pagos ni locks', () => {
    expect(sql091).not.toContain('LOCK TABLE');
    expect(sql091Code).not.toContain('ERR_AGENCY_HAS_ACTIVE_CHECKOUTS');
    expect(sql091).not.toMatch(/INTERVAL\s+'(600|900)/i);
    expect(sql091).not.toMatch(/UPDATE public\.seats/);
    // Un unico trigger, el de updated_at de la propia tabla.
    expect((sql091.match(/CREATE TRIGGER/g) ?? []).length).toBe(1);
    expect(sql091).toContain('CREATE TRIGGER agency_contacts_updated_t');
    expect(sql091).not.toMatch(/ALTER TABLE public\.agencies/);
    expect(sql091).not.toMatch(/ALTER TABLE public\.agency_payment_methods/);
    expect(sql091).not.toMatch(/ALTER TABLE public\.checkout_attempts/);
    expect(sql091).not.toMatch(/CREATE OR REPLACE FUNCTION public\.(verify|submit|reject|cancel|cleanup)_checkout/);
    expect(sql091).not.toMatch(/CREATE OR REPLACE FUNCTION public\.(create|update|delete|set)_agency_payment_method/);
  });

  it('extiende los CHECKs de audit_log de forma aditiva con guards', () => {
    expect(sql091).toContain('ERR_091_ACTION_GUARD');
    expect(sql091).toContain('ERR_091_ENTITY_GUARD');
    expect(sql091).toContain('audit_log_action_check');
    expect(sql091).toContain('audit_log_entity_type_check');
    expect(sql091).toContain("'agency_payment_method.deleted'");
    expect(sql091).toContain("'agency_contact.created'");
  });

  it('el rollback elimina exclusivamente objetos de 091 y documenta sus limites', () => {
    expect(sqlRollback).toContain('DROP TABLE IF EXISTS public.agency_contacts');
    expect(sqlRollback).toContain('DROP TRIGGER IF EXISTS agency_contacts_updated_t');
    expect(sqlRollback).toContain('DROP FUNCTION IF EXISTS public.create_agency_contact');
    expect(sqlRollback).toContain('DROP FUNCTION IF EXISTS public.update_agency_contact');
    expect(sqlRollback).toContain('DROP FUNCTION IF EXISTS public.delete_agency_contact');
    expect(sqlRollback).toContain('DROP FUNCTION IF EXISTS public.agency_contact_normalize_phone');
    expect(sqlRollback).not.toMatch(/DROP TABLE IF EXISTS public\.(?!agency_contacts)/);
    expect(sqlRollback).not.toMatch(/DROP FUNCTION IF EXISTS public\.(?!create_agency_contact|update_agency_contact|delete_agency_contact|agency_contact_normalize_phone)/);
    expect(sqlRollback).toMatch(/NO garantiza restaurar contactos/i);
    expect(sqlRollback).toMatch(/borrado logico/i);
    // Restaura los CHECKs de 089 (sin agency_contact) como constraints.
    expect(sqlRollback).toContain("'agency_payment_method.deleted'");
    expect(sqlRollback).toContain('Restaurado por 091_rollback');
  });

  it('los guards del rollback aceptan el estado de 091 y rechazan migraciones posteriores', () => {
    // v_known de los guards: 089 + valores de 091 (29 acciones / 10 entidades).
    const knownArrays = [
      ...sqlRollback.matchAll(/v_known TEXT\[\] := ARRAY\[(.*?)\];/gs),
    ].map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    expect(knownArrays).toHaveLength(2);
    const [knownActions, knownEntities] = knownArrays;

    // Sin duplicados y con los valores historicos de 089 conservados.
    expect(new Set(knownActions).size).toBe(knownActions.length);
    expect(new Set(knownEntities).size).toBe(knownEntities.length);
    expect(knownActions.length).toBe(29);
    expect(knownEntities.length).toBe(10);
    for (const action of [
      'agency_payment_method.created',
      'agency_payment_method.primary_set',
      'checkout.rejected',
      'reservation.passenger_cancelled',
      'trip.created',
    ]) {
      expect(knownActions).toContain(action);
    }
    expect(knownEntities).toContain('agency_payment_method');
    expect(knownEntities).toContain('checkout_attempt');
    expect(knownEntities).toContain('trip');

    // Los valores nuevos de 091 estan en los guards (acepta su propio estado).
    for (const action of [
      'agency_contact.created',
      'agency_contact.updated',
      'agency_contact.deleted',
    ]) {
      expect(knownActions).toContain(action);
    }
    expect(knownEntities).toContain('agency_contact');

    // Los guards siguen presentes y rechazan valores no reconocidos (092+).
    expect(sqlRollback).toContain("RAISE EXCEPTION 'ERR_091_ROLLBACK_ACTION:");
    expect(sqlRollback).toContain("RAISE EXCEPTION 'ERR_091_ROLLBACK_ENTITY:");
    // El CHECK restaurado NO vuelve a incluir agency_contact (listas 089).
    const restoredActionCheck = sqlRollback.slice(
      sqlRollback.indexOf('ADD CONSTRAINT audit_log_action_check'),
    );
    expect(restoredActionCheck).not.toMatch(/'agency_contact\./);
    const restoredEntityCheck = sqlRollback.slice(
      sqlRollback.indexOf('ADD CONSTRAINT audit_log_entity_type_check'),
    );
    expect(restoredEntityCheck.split('COMMENT')[0]).not.toContain("'agency_contact'");
  });

  it('el rollback exige cero eventos de contactos antes de tocar objetos', () => {
    // La precondicion consulta audit_log y aborta con mensaje accionable.
    expect(sqlRollback).toContain("RAISE EXCEPTION 'ERR_091_ROLLBACK_AUDIT_EVENTS:");
    expect(sqlRollback).toMatch(/FROM public\.audit_log/);
    expect(sqlRollback).toMatch(
      /WHERE action IN \([\s\S]*?'agency_contact\.created'[\s\S]*?'agency_contact\.deleted'[\s\S]*?\)\s+OR entity_type = 'agency_contact'/,
    );
    // Mensaje accionable: que decidir y que no borrar.
    expect(sqlRollback).toMatch(/politica de retencion/i);
    expect(sqlRollback).toMatch(/append-only/i);

    // Se evalua ANTES de cualquier DROP destructivo.
    const preconditionAt = sqlRollback.indexOf('ERR_091_ROLLBACK_AUDIT_EVENTS');
    const firstDropAt = sqlRollback.indexOf('DROP FUNCTION IF EXISTS');
    expect(preconditionAt).toBeGreaterThan(-1);
    expect(firstDropAt).toBeGreaterThan(-1);
    expect(preconditionAt).toBeLessThan(firstDropAt);

    // Nunca borra, modifica ni desactiva auditoria ni su trigger.
    expect(sqlRollback).not.toMatch(/DELETE\s+FROM\s+public\.audit_log/i);
    expect(sqlRollback).not.toMatch(/UPDATE\s+public\.audit_log/i);
    expect(sqlRollback).not.toMatch(/TRUNCATE/i);
    expect(sqlRollback).not.toMatch(/DISABLE\s+TRIGGER/i);
    expect(sqlRollback).not.toMatch(/trg_audit_log_append_only/);
  });
});

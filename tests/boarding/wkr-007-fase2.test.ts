/**
 * @vitest-environment node
 *
 * WKR-007 Fase 2 — static contracts for the transactional trip RPCs
 * (migration 057). No live DB; supabase/tests/wkr_007_3_rpc_verification.sql
 * validates runtime behavior non-destructively.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function listMigrations(): string[] {
  return fs
    .readdirSync(path.join(REPO_ROOT, 'supabase/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

const migration057 = read('supabase/migrations/057_trip_events_rpc.sql');
const harness = read('supabase/tests/wkr_007_3_rpc_verification.sql');

const RPC_NAMES = [
  'emit_trip_event',
  'create_trip',
  'update_trip',
  'set_trip_status',
  'complete_trip',
  'archive_trip',
];

// Public transactional RPCs only. emit_trip_event is an internal SQL helper
// (RETURNS void) — not part of the public contract surface (decision D1).
const PUBLIC_RPC_NAMES = RPC_NAMES.filter((name) => name !== 'emit_trip_event');

const EVENT_TYPES = [
  'trip.created',
  'trip.postponed',
  'trip.cancelled',
  'trip.completed',
  'trip.auto_completed',
  'trip.updated',
  'trip.archived',
];

describe('WKR-007 Fase 2 — migration isolation', () => {
  it('adds only migration 057 after 056', () => {
    const migrations = listMigrations();
    expect(migrations).toContain('056_outbox_trigger_retrofit_dedup_key.sql');
    expect(migrations).toContain('057_trip_events_rpc.sql');
    expect(migrations.indexOf('057_trip_events_rpc.sql')).toBe(
      migrations.length - 1,
    );
  });

  it('has no tracked modifications in migrations 001–056', () => {
    const status = execFileSync(
      'git',
      [
        'status',
        '--porcelain',
        '--untracked-files=no',
        '--',
        'supabase/migrations',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    const historicalChanges = status
      .split(/\r?\n/)
      .filter((line) => /supabase\/migrations\/0\d\d_/.test(line))
      .filter((line) => !/057_trip_events_rpc\.sql/.test(line));

    expect(historicalChanges).toEqual([]);
  });
});

describe('WKR-007 Fase 2 — RPC surface', () => {
  it('defines all 5 RPCs + the private emit helper as SECURITY DEFINER with search_path', () => {
    for (const name of RPC_NAMES) {
      expect(migration057).toContain(`CREATE OR REPLACE FUNCTION public.${name}(`);
      expect(migration057).toContain('SECURITY DEFINER');
      expect(migration057).toContain('SET search_path = public');
    }
    expect(migration057.match(/CREATE OR REPLACE FUNCTION public\./g)).toHaveLength(
      RPC_NAMES.length,
    );
  });

  it('grants EXECUTE to service_role only (posture 037/047)', () => {
    expect(migration057.match(/GRANT EXECUTE ON FUNCTION public\./g)).toHaveLength(
      RPC_NAMES.length,
    );
    expect(migration057).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.[^ ]+ TO (anon|authenticated|public)/);
  });

  it('returns JSONB from every public RPC (emit_trip_event excluded)', () => {
    const blocks = migration057.split('CREATE OR REPLACE FUNCTION public.');
    for (const name of PUBLIC_RPC_NAMES) {
      const block = blocks.find((b) => b.startsWith(name + '('));
      expect(block).toBeTruthy();
      expect(block).toContain('RETURNS JSONB');
    }
  });
});

describe('WKR-007 Fase 2 — event emission contract', () => {
  it('emits all 7 trip.* event types from the RPC layer', () => {
    for (const type of EVENT_TYPES) {
      if (type === 'trip.cancelled') continue;
      expect(migration057).toContain(`'${type}'`);
    }
    // trip.cancelled is constructed dynamically in set_trip_status (D2):
    // 'trip.' || p_status yields trip.cancelled / trip.completed at runtime.
    expect(migration057).toContain("'trip.' || p_status");
  });

  it('uses tenant_id NULL for every trip event (multi-agency facts)', () => {
    const helperBlock = migration057.split('CREATE OR REPLACE FUNCTION public.emit_trip_event(')[1];
    expect(helperBlock).toContain('NULL,');
    expect(helperBlock).toContain('p_payload');
    expect(helperBlock).toContain('ON CONFLICT DO NOTHING');
  });

  it('uses deterministic dedup keys per design §9.1', () => {
    expect(migration057).toContain("'trip.created:' || v_trip.id::text");
    expect(migration057).toContain("'trip.postponed:' || p_trip_id::text");
    expect(migration057).toContain("'trip.completed:' || p_trip_id::text");
    expect(migration057).toContain("'trip.auto_completed:' || p_trip_id::text");
    expect(migration057).toContain("'trip.updated:' || p_trip_id::text");
    expect(migration057).toContain("'trip.archived:' || p_trip_id::text");
    // trip.cancelled:{trip_id} is built dynamically in set_trip_status (D2);
    // the runtime envelope + dedup value are validated by the SQL harness (G).
    expect(migration057).toContain("'trip.' || p_status || ':' || p_trip_id::text");
    expect(
      migration057.match(/YYYY-MM-DD"T"HH24:MI:SS\.US"Z"/g),
    ).toHaveLength(3);
  });

  it('emits trip.updated with changed_fields and a changed_fields_hash', () => {
    expect(migration057).toContain("'changed_fields', to_jsonb(v_sorted_fields)");
    expect(migration057).toContain('md5(array_to_string(v_sorted_fields');
    expect(migration057).toContain("v_sorted_fields := ARRAY(");
    expect(migration057.match(/array_append\(v_changed_fields,/g)).toHaveLength(5);
    expect(migration057).not.toMatch(
      /v_changed_fields\s*:=\s*v_changed_fields\s*\|\|\s*'/,
    );
  });

  it('uses ON CONFLICT DO NOTHING without a conflict target', () => {
    // A) OUTBOX — the no-target rule (§9.4) applies to the outbox insert in
    // emit_trip_event only, never as a global regex over the whole migration.
    const helperDef = migration057
      .split('CREATE OR REPLACE FUNCTION public.emit_trip_event(')[1]
      .split('COMMENT ON FUNCTION public.emit_trip_event')[0];
    expect(helperDef).toContain('INSERT INTO public.outbox_events');
    expect(helperDef).toMatch(/ON\s+CONFLICT\s+DO\s+NOTHING/i);
    expect(helperDef).not.toMatch(/ON\s+CONFLICT\s*\(/i);
    expect(helperDef).not.toMatch(/ON\s+CONFLICT\s+ON\s+CONSTRAINT/i);
    // B) SEATS — the seats inventory upsert legitimately keeps its
    // (trip_id, seat_code) conflict target; asserted separately in
    // "releases seats on cancel and adjusts seats on capacity change".
  });
});

describe('WKR-007 Fase 2 — atomicity + invariants', () => {
  it('locks the trip row with FOR UPDATE before mutating (race protection)', () => {
    expect(migration057).toMatch(/SELECT \* INTO v_trip FROM trips WHERE id = p_trip_id FOR UPDATE/g);
  });

  it('protects the duplicate race with unique_violation -> ERR_TRIP_DUPLICATE', () => {
    expect(migration057).toContain('EXCEPTION WHEN unique_violation THEN');
    expect(migration057).toContain('ERR_TRIP_DUPLICATE');
  });

  it('releases seats on cancel and adjusts seats on capacity change', () => {
    expect(migration057).toContain("AND status IN ('locked', 'reserved', 'blocked')");
    expect(migration057).toContain('ERR_SEATS_IN_USE');
    expect(migration057).toContain('ON CONFLICT (trip_id, seat_code) DO NOTHING');
  });

  it('decides postpone vs updated inside update_trip (design §4.1 collapse)', () => {
    expect(migration057).toContain('v_real_postpone := p_postpone AND');
    expect(migration057).toContain("'trip.postponed'");
    expect(migration057).toContain("'trip.updated'");
  });
});

describe('WKR-007 Fase 2 — verification harness', () => {
  it('is a non-destructive BEGIN / ROLLBACK script', () => {
    expect(harness).toMatch(/\bBEGIN\s*;/i);
    expect(harness.trimEnd()).toMatch(/ROLLBACK;$/i);
  });

  it('covers all 5 RPCs and the helper', () => {
    for (const name of PUBLIC_RPC_NAMES) {
      expect(harness).toContain(`public.${name}(`);
    }
    // emit_trip_event is covered structurally via pg_proc metadata checks
    // (existence, SECURITY DEFINER, search_path, grants, outbox insert
    // discipline) — never invoked directly (D1).
    expect(harness).toContain("'emit_trip_event'");
  });

  it('checks function security through PostgreSQL metadata, not deparsed SQL text', () => {
    expect(harness).toContain('p.proconfig');
    expect(harness).toContain("'search_path=public' = ANY(v_row.proconfig)");
    expect(harness).toContain('SELECT p.oid, p.proname');
    expect(harness).toContain("has_function_privilege('service_role'");
    expect(harness).not.toContain('pg_get_function_identity_arguments');
    expect(harness).not.toContain('v_row.def NOT ILIKE');
  });

  it('asserts the envelope + dedup discipline at runtime', () => {
    expect(harness).toContain('trip.created envelope mismatch');
    expect(harness).toContain('trip.postponed envelope mismatch');
    expect(harness).toContain('trip.updated envelope mismatch');
    expect(harness).toContain('trip.cancelled envelope mismatch');
    expect(harness).toContain('trip.auto_completed envelope mismatch');
    expect(harness).toContain('trip.completed envelope mismatch');
    expect(harness).toContain('trip.archived envelope mismatch');
    expect(harness).toContain('dedup ON CONFLICT DO NOTHING (no conflict target)');
    expect(harness).toContain(
      'rejected shrink left partial trip/seat changes',
    );
    expect(harness).toContain('rejected shrink emitted trip.updated');
  });
});

describe('WKR-007 Fase 2 — phase boundary (services not rewritten yet)', () => {
  it('keeps superadmin.service.ts on the legacy PostgREST path', () => {
    const svc = read('backend/src/services/superadmin.service.ts');
    expect(svc).toContain('supabaseAdmin.from("trips")');
    expect(svc).not.toContain('.rpc(');
  });

  it('keeps trip.service.ts on the bulk completeExpiredTrips path', () => {
    const tripSvc = read('backend/src/services/trip.service.ts');
    expect(tripSvc).toMatch(/\.update\(\{\s*status:\s*["']completed["']\s*\}\)/);
    expect(tripSvc).not.toContain('complete_trip');
  });

  it('declares TRIP_EFFECTS_VIA_OUTBOX disabled without service wiring or trip handlers', () => {
    const env = read('backend/src/config/env.ts');
    const superadminSvc = read('backend/src/services/superadmin.service.ts');
    const tripSvc = read('backend/src/services/trip.service.ts');

    expect(env).toContain('TRIP_EFFECTS_VIA_OUTBOX: z');
    expect(
      env.split('TRIP_EFFECTS_VIA_OUTBOX: z')[1]?.split('OUTBOX_POLL_MS')[0],
    ).toContain('.default(false)');
    expect(superadminSvc).not.toContain('TRIP_EFFECTS_VIA_OUTBOX');
    expect(tripSvc).not.toContain('TRIP_EFFECTS_VIA_OUTBOX');

    const handlers = read('backend/src/workers/handlers/index.ts');
    expect(handlers).not.toMatch(/trip\.(created|postponed|cancelled|completed|auto_completed|updated|archived)/);
  });
});

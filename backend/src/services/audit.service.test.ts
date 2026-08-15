import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../errors/index.js';
import {
  encodeAuditCursor,
  decodeAuditCursor,
  quotePostgrestValue,
} from '../utils/audit-cursor.js';
import type { AuditLogRow } from '../types/audit.js';

type ChainResult = {
  data: unknown;
  error: { message: string } | null;
};

function createChainable(result: ChainResult = { data: [], error: null }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.gte = vi.fn(self);
  chain.lte = vi.fn(self);
  chain.or = vi.fn(self);
  chain.order = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.then = (resolve: (v: ChainResult) => void) => {
    resolve(result);
  };
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    gte: ReturnType<typeof vi.fn>;
    lte: ReturnType<typeof vi.fn>;
    or: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    then: (resolve: (v: ChainResult) => void) => void;
  };
}

const tableChains: Record<string, ReturnType<typeof createChainable>> = {};

const mockFrom = vi.fn((table: string) => {
  if (!tableChains[table]) {
    tableChains[table] = createChainable();
  }
  return tableChains[table];
});

vi.mock('../config/database.js', () => ({
  get supabaseAdmin() {
    return { from: mockFrom };
  },
}));

import {
  auditService,
  buildAgencyTenantOrFilter,
  buildKeysetOrFilter,
  sanitizeAuditMetadata,
  toAuditEventDTO,
} from './audit.service.js';

const AGENCY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AGENCY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TRIP_A1 = '11111111-1111-4111-8111-111111111111';
const TRIP_B1 = '22222222-2222-4222-8222-222222222222';
const ACTOR_A = '33333333-3333-4333-8333-333333333333';
const EVENT_1 = '44444444-4444-4444-8444-444444444444';
const EVENT_2 = '55555555-5555-4555-8555-555555555555';
const T1 = '2026-08-15T12:00:00.000Z';
const T2 = '2026-08-15T11:00:00.000Z';

function row(partial: Partial<AuditLogRow> & Pick<AuditLogRow, 'id'>): AuditLogRow {
  return {
    id: partial.id,
    occurred_at: partial.occurred_at ?? T1,
    actor_user_id: partial.actor_user_id ?? ACTOR_A,
    actor_role: partial.actor_role ?? 'agency',
    agency_id: partial.agency_id ?? AGENCY_A,
    action: partial.action ?? 'reservation.created',
    entity_type: partial.entity_type ?? 'reservation',
    entity_id: partial.entity_id ?? EVENT_1,
    before: partial.before ?? null,
    after: partial.after ?? { trip_id: TRIP_A1, passenger_count: 1, seat_codes: ['A1'] },
    metadata: partial.metadata ?? {
      source: 'api',
      ip: '1.2.3.4',
      user_agent: 'vitest',
      seat_code: 'A1',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(tableChains)) {
    delete tableChains[key];
  }
});

describe('audit cursor helpers', () => {
  it('round-trips encode/decode', () => {
    const encoded = encodeAuditCursor({ t: T1, i: EVENT_1 });
    expect(decodeAuditCursor(encoded)).toEqual({ t: T1, i: EVENT_1 });
  });

  it('rejects invalid cursor', () => {
    expect(() => decodeAuditCursor('not-valid')).toThrow(ValidationError);
    expect(() => decodeAuditCursor(encodeAuditCursor({ t: 'nope', i: EVENT_1 }))).toThrow(
      ValidationError,
    );
  });

  it('quotes ISO timestamps for PostgREST', () => {
    expect(quotePostgrestValue(T1)).toBe(`"${T1}"`);
  });
});

describe('sanitizeAuditMetadata / DTO', () => {
  it('strips ip/user_agent for agency; keeps for admin', () => {
    const meta = {
      source: 'api',
      ip: '9.9.9.9',
      user_agent: 'ua',
      seat_code: 'A2',
      freed_seat_count: 2,
      token: 'secret',
    };
    expect(sanitizeAuditMetadata(meta, 'agency')).toEqual({
      source: 'api',
      seat_code: 'A2',
      freed_seat_count: 2,
    });
    expect(sanitizeAuditMetadata(meta, 'superadmin')).toEqual({
      source: 'api',
      ip: '9.9.9.9',
      user_agent: 'ua',
      seat_code: 'A2',
      freed_seat_count: 2,
    });
  });

  it('maps system actor to null and sanitizes before/after via allowlist', () => {
    const dto = toAuditEventDTO(
      row({
        id: EVENT_1,
        action: 'reservation.cancelled',
        actor_user_id: null,
        actor_role: 'system',
        before: { status: 'confirmed', email: 'leak@example.com' },
        after: { status: 'cancelled', token: 'x' },
      }),
      'superadmin',
    );
    expect(dto.actor).toBeNull();
    expect(dto.before).toEqual({ status: 'confirmed' });
    expect(dto.after).toEqual({ status: 'cancelled' });
  });

  it('maps human actor without email/name enrichment', () => {
    const dto = toAuditEventDTO(row({ id: EVENT_1 }), 'agency');
    expect(dto.actor).toEqual({
      user_id: ACTOR_A,
      role: 'agency',
      agency_id: AGENCY_A,
    });
    expect(dto).not.toHaveProperty('actor_user_id');
    expect(dto).not.toHaveProperty('actor_role');
    expect(JSON.stringify(dto)).not.toMatch(/email|name/i);
  });
});

describe('filter builders', () => {
  it('builds keyset OR with quoted timestamp', () => {
    expect(buildKeysetOrFilter(T1, EVENT_1)).toBe(
      `occurred_at.lt."${T1}",and(occurred_at.eq."${T1}",id.lt.${EVENT_1})`,
    );
  });

  it('builds agency tenant OR with trip ids; omits empty in()', () => {
    expect(buildAgencyTenantOrFilter(AGENCY_A, [])).toBe(
      `agency_id.eq.${AGENCY_A}`,
    );
    expect(buildAgencyTenantOrFilter(AGENCY_A, [TRIP_A1, 'not-a-uuid'])).toBe(
      `agency_id.eq.${AGENCY_A},and(entity_type.eq.trip,entity_id.in.(${TRIP_A1}))`,
    );
  });
});

describe('AuditService.getAdminAudit', () => {
  it('queries without tenant scope by default', async () => {
    const rows = [row({ id: EVENT_1 })];
    tableChains['audit_log'] = createChainable({ data: rows, error: null });

    const result = await auditService.getAdminAudit({ limit: 50 });

    expect(mockFrom).toHaveBeenCalledWith('audit_log');
    expect(tableChains['audit_log'].eq).not.toHaveBeenCalledWith(
      'agency_id',
      expect.anything(),
    );
    expect(tableChains['audit_log'].order).toHaveBeenCalledWith('occurred_at', {
      ascending: false,
    });
    expect(tableChains['audit_log'].order).toHaveBeenCalledWith('id', {
      ascending: false,
    });
    expect(tableChains['audit_log'].limit).toHaveBeenCalledWith(51);
    expect(result.items).toHaveLength(1);
    expect(result.next_cursor).toBeNull();
  });

  it('applies optional agency_id and other filters', async () => {
    tableChains['audit_log'] = createChainable({ data: [], error: null });

    await auditService.getAdminAudit({
      limit: 10,
      agency_id: AGENCY_B,
      action: 'trip.created',
      entity_type: 'trip',
      entity_id: TRIP_B1,
      actor_user_id: ACTOR_A,
      from: T2,
      to: T1,
    });

    const chain = tableChains['audit_log'];
    expect(chain.eq).toHaveBeenCalledWith('agency_id', AGENCY_B);
    expect(chain.eq).toHaveBeenCalledWith('action', 'trip.created');
    expect(chain.eq).toHaveBeenCalledWith('entity_type', 'trip');
    expect(chain.eq).toHaveBeenCalledWith('entity_id', TRIP_B1);
    expect(chain.eq).toHaveBeenCalledWith('actor_user_id', ACTOR_A);
    expect(chain.gte).toHaveBeenCalledWith('occurred_at', T2);
    expect(chain.lte).toHaveBeenCalledWith('occurred_at', T1);
    expect(chain.limit).toHaveBeenCalledWith(11);
  });

  it('applies keyset cursor and returns next_cursor when has_more', async () => {
    const rows = [
      row({ id: EVENT_1, occurred_at: T1 }),
      row({ id: EVENT_2, occurred_at: T2 }),
      row({ id: '66666666-6666-4666-8666-666666666666', occurred_at: T2 }),
    ];
    tableChains['audit_log'] = createChainable({ data: rows, error: null });

    const cursor = { t: T1, i: EVENT_1 };
    const result = await auditService.getAdminAudit({
      limit: 2,
      cursor,
    });

    expect(tableChains['audit_log'].or).toHaveBeenCalledWith(
      buildKeysetOrFilter(T1, EVENT_1),
    );
    expect(result.items).toHaveLength(2);
    expect(result.next_cursor).toBe(
      encodeAuditCursor({ t: T2, i: EVENT_2 }),
    );
  });

  it('admin DTO keeps ip/user_agent metadata', async () => {
    tableChains['audit_log'] = createChainable({
      data: [row({ id: EVENT_1 })],
      error: null,
    });

    const result = await auditService.getAdminAudit({ limit: 50 });
    expect(result.items[0].metadata).toMatchObject({
      ip: '1.2.3.4',
      user_agent: 'vitest',
    });
  });
});

describe('AuditService.getAgencyAudit — tenancy', () => {
  it('scopes to agency_id only when no trips (no empty .in())', async () => {
    tableChains['trip_agencies'] = createChainable({ data: [], error: null });
    tableChains['audit_log'] = createChainable({ data: [], error: null });

    await auditService.getAgencyAudit(AGENCY_A, { limit: 50 });

    expect(mockFrom).toHaveBeenCalledWith('trip_agencies');
    expect(tableChains['trip_agencies'].eq).toHaveBeenCalledWith(
      'agency_id',
      AGENCY_A,
    );
    expect(tableChains['audit_log'].eq).toHaveBeenCalledWith(
      'agency_id',
      AGENCY_A,
    );
    expect(tableChains['audit_log'].or).not.toHaveBeenCalled();
  });

  it('OR-scopes agency events + trip.* via trip_agencies', async () => {
    tableChains['trip_agencies'] = createChainable({
      data: [{ trip_id: TRIP_A1 }],
      error: null,
    });
    tableChains['audit_log'] = createChainable({
      data: [
        row({
          id: EVENT_1,
          agency_id: AGENCY_A,
          action: 'reservation.created',
        }),
        row({
          id: EVENT_2,
          agency_id: null,
          action: 'trip.updated',
          entity_type: 'trip',
          entity_id: TRIP_A1,
          actor_role: 'superadmin',
          actor_user_id: ACTOR_A,
        }),
      ],
      error: null,
    });

    const result = await auditService.getAgencyAudit(AGENCY_A, { limit: 50 });

    expect(tableChains['audit_log'].or).toHaveBeenCalledWith(
      buildAgencyTenantOrFilter(AGENCY_A, [TRIP_A1]),
    );
    expect(result.items).toHaveLength(2);
    // Agency metadata stripped
    expect(result.items[0].metadata.ip).toBeUndefined();
    expect(result.items[0].metadata.user_agent).toBeUndefined();
  });

  it('rejects agency_id filter on service (defense in depth)', async () => {
    await expect(
      auditService.getAgencyAudit(AGENCY_A, {
        limit: 50,
        agency_id: AGENCY_B,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('combines actor_user_id with tenant scope (no existence oracle)', async () => {
    tableChains['trip_agencies'] = createChainable({ data: [], error: null });
    tableChains['audit_log'] = createChainable({ data: [], error: null });

    const result = await auditService.getAgencyAudit(AGENCY_A, {
      limit: 50,
      actor_user_id: ACTOR_A,
    });

    expect(tableChains['audit_log'].eq).toHaveBeenCalledWith(
      'agency_id',
      AGENCY_A,
    );
    expect(tableChains['audit_log'].eq).toHaveBeenCalledWith(
      'actor_user_id',
      ACTOR_A,
    );
    expect(result.items).toEqual([]);
  });

  it('never applies Agency B id in tenant filter for Agency A', async () => {
    tableChains['trip_agencies'] = createChainable({
      data: [{ trip_id: TRIP_A1 }],
      error: null,
    });
    tableChains['audit_log'] = createChainable({ data: [], error: null });

    await auditService.getAgencyAudit(AGENCY_A, {
      limit: 50,
      entity_type: 'trip',
      entity_id: TRIP_B1,
    });

    const orArg = tableChains['audit_log'].or.mock.calls[0]?.[0] as string;
    expect(orArg).toContain(AGENCY_A);
    expect(orArg).not.toContain(AGENCY_B);
    expect(orArg).toContain(TRIP_A1);
    expect(orArg).not.toContain(TRIP_B1);
    expect(tableChains['audit_log'].eq).toHaveBeenCalledWith(
      'entity_id',
      TRIP_B1,
    );
  });
});

describe('pagination tie-break', () => {
  it('uses id as secondary key when timestamps equal', () => {
    const filter = buildKeysetOrFilter(T1, EVENT_1);
    expect(filter).toContain(`occurred_at.eq."${T1}"`);
    expect(filter).toContain(`id.lt.${EVENT_1}`);
  });
});

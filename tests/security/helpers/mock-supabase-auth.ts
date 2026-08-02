import { vi } from 'vitest';

export function createChainable(result: unknown = null, error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve({ data: result, error }));
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: result, error }));
  return chain;
}

export function createMockDatabase() {
  const tableChains: Record<string, ReturnType<typeof createChainable>> = {};
  const mockGetUser = vi.fn();

  const databaseMock = {
    get supabase() {
      return {
        auth: { getUser: mockGetUser },
      };
    },
    get supabaseAdmin() {
      return {
        from: (table: string) => {
          if (!tableChains[table]) {
            tableChains[table] = createChainable();
          }
          return tableChains[table];
        },
      };
    },
  };

  return { tableChains, mockGetUser, databaseMock };
}

/** Simulated forged JWT metadata (client-writable). */
export const FORGED_SUPERADMIN_METADATA = {
  role: 'superadmin',
  agency_id: null,
} as const;

/** Ground truth in public.users for an agency operator. */
export const DB_AGENCY_USER = {
  id: 'user-1',
  email: 'agent@example.com',
  role: 'agency',
  agency_id: 'agency-1',
} as const;

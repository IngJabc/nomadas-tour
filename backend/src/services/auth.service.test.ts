import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgencyInactiveError, UnauthorizedError } from '../errors/index.js';

function createChainable(result: unknown = null, error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.gt = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve({ data: result, error }));
  chain.upsert = vi.fn(() => Promise.resolve({ error: null }));
  chain.update = vi.fn(() => chain);
  chain.then = vi.fn((resolve: (value: { error: null }) => void) => {
    resolve({ error: null });
    return Promise.resolve({ error: null });
  });
  return chain;
}

const tableChains: Record<string, ReturnType<typeof createChainable>> = {};
const mockListUsers = vi.fn();
const mockUpdateUserById = vi.fn();
const mockCreateUser = vi.fn();
const mockSignInWithPassword = vi.fn();

vi.mock('../config/database.js', () => ({
  get supabase() {
    return {
      auth: {
        signInWithPassword: mockSignInWithPassword,
        admin: {
          listUsers: mockListUsers,
          updateUserById: mockUpdateUserById,
          createUser: mockCreateUser,
        },
      },
    };
  },
  get supabaseAdmin() {
    return {
      auth: {
        admin: {
          listUsers: mockListUsers,
        },
      },
      from: (table: string) => {
        if (!tableChains[table]) {
          tableChains[table] = createChainable();
        }
        return tableChains[table];
      },
    };
  },
}));

vi.mock('./email.service.js', () => ({
  emailService: {
    sendRegistrationCompleteEmail: async () => undefined,
    sendResetPasswordEmail: async () => undefined,
    sendInvitationEmail: async () => undefined,
  },
}));

import { authService } from './auth.service.js';

const INVITATION = {
  id: 'inv-1',
  email: 'agent@example.com',
  agency_id: 'agency-1',
  token: 'invite-token',
  agencies: { name: 'Agencia Test' },
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(tableChains)) {
    delete tableChains[key];
  }
});

describe('authService.login', () => {
  it('returns only safe user columns (no password_hash)', async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: {
        user: { id: 'user-1' },
        session: { access_token: 'tok', refresh_token: 'ref' },
      },
      error: null,
    });

    tableChains.users = createChainable({
      id: 'user-1',
      email: 'agent@example.com',
      role: 'agency',
      agency_id: 'agency-1',
    });
    tableChains.agencies = createChainable({ status: 'active' });

    const result = await authService.login('agent@example.com', 'pass');

    expect(tableChains.users.select).toHaveBeenCalledWith('id, email, role, agency_id');
    expect(result.user).toEqual({
      id: 'user-1',
      email: 'agent@example.com',
      role: 'agency',
      agency_id: 'agency-1',
    });
    expect(result.user).not.toHaveProperty('password_hash');
  });
});

describe('authService.getMe', () => {
  it('returns identity from public.users only', async () => {
    tableChains.users = createChainable({
      id: 'user-1',
      email: 'agent@example.com',
      role: 'agency',
      agency_id: 'agency-1',
    });
    tableChains.agencies = createChainable({ status: 'active' });

    const user = await authService.getMe('user-1');

    expect(user).toEqual({
      id: 'user-1',
      email: 'agent@example.com',
      role: 'agency',
      agency_id: 'agency-1',
    });
  });

  it('throws when user is missing in public.users', async () => {
    tableChains.users = createChainable(null, { message: 'not found' });

    await expect(authService.getMe('missing')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws when agency subscription is inactive', async () => {
    tableChains.users = createChainable({
      id: 'user-1',
      email: 'agent@example.com',
      role: 'agency',
      agency_id: 'agency-1',
    });
    tableChains.agencies = createChainable({ status: 'inactive' });

    await expect(authService.getMe('user-1')).rejects.toBeInstanceOf(AgencyInactiveError);
  });

  it('allows superadmin without agency lookup', async () => {
    tableChains.users = createChainable({
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'superadmin',
      agency_id: null,
    });

    const user = await authService.getMe('admin-1');

    expect(user.role).toBe('superadmin');
  });
});

function seedAcceptInvitationMocks() {
  tableChains.agency_invitations = createChainable(INVITATION);
  tableChains.users = createChainable(null);
  tableChains.agencies = createChainable(null);
  mockListUsers.mockResolvedValue({ data: { users: [] } });
  mockUpdateUserById.mockResolvedValue({ error: null });
  mockCreateUser.mockResolvedValue({
    data: { user: { id: 'new-user-1' } },
    error: null,
  });
  mockSignInWithPassword.mockResolvedValue({
    data: {
      session: { access_token: 'token-1', refresh_token: 'refresh-1' },
      user: { id: 'new-user-1' },
    },
    error: null,
  });
}

describe('authService.acceptInvitation', () => {
  it('creates auth user without user_metadata and stores role in public.users', async () => {
    seedAcceptInvitationMocks();

    const result = await authService.acceptInvitation('invite-token', 'Password123!');

    expect(mockCreateUser).toHaveBeenCalledWith({
      email: INVITATION.email,
      password: 'Password123!',
      email_confirm: true,
    });
    expect(mockCreateUser.mock.calls[0][0]).not.toHaveProperty('user_metadata');
    expect(mockUpdateUserById).not.toHaveBeenCalled();

    expect(tableChains.users.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'new-user-1',
        email: INVITATION.email,
        role: 'agency',
        agency_id: INVITATION.agency_id,
      }),
      { onConflict: 'id' },
    );

    expect(result.user).toEqual({
      id: 'new-user-1',
      email: INVITATION.email,
      role: 'agency',
      agency_id: INVITATION.agency_id,
    });
  });

  it('updates existing auth user without user_metadata and upserts public.users', async () => {
    seedAcceptInvitationMocks();
    mockListUsers.mockResolvedValue({
      data: { users: [{ id: 'existing-user-1', email: INVITATION.email }] },
    });
    mockSignInWithPassword.mockResolvedValue({
      data: {
        session: { access_token: 'token-2', refresh_token: 'refresh-2' },
        user: { id: 'existing-user-1' },
      },
      error: null,
    });

    const result = await authService.acceptInvitation('invite-token', 'Password123!');

    expect(mockUpdateUserById).toHaveBeenCalledWith('existing-user-1', {
      password: 'Password123!',
      email_confirm: true,
    });
    expect(mockUpdateUserById.mock.calls[0][1]).not.toHaveProperty('user_metadata');
    expect(mockCreateUser).not.toHaveBeenCalled();

    expect(tableChains.users.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'existing-user-1',
        role: 'agency',
        agency_id: INVITATION.agency_id,
      }),
      { onConflict: 'id' },
    );

    expect(result.user.role).toBe('agency');
  });
});

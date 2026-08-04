import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuthUser } from '@/components/auth/AuthProvider';
import type { AppUser } from '@/lib/auth/types';

const mocks = vi.hoisted(() => {
  let authStateHandler: ((event: string, session: unknown) => void) | null = null;
  return {
    getSession: vi.fn(),
    me: vi.fn(),
    onAuthStateChange: vi.fn((handler: (event: string, session: unknown) => void) => {
      authStateHandler = handler;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    emitAuthState: (event: string, session: unknown = null) => {
      authStateHandler?.(event, session);
    },
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signOut: vi.fn(),
    },
  }),
}));

vi.mock('@/lib/api', () => ({
  authApi: { me: mocks.me },
}));

const USER: AppUser = {
  id: 'user-1',
  email: 'agent@example.com',
  role: 'agency',
  agency_id: 'agency-1',
  agency_name: 'Agencia Demo',
};

function Probe() {
  const { user, loading } = useAuthUser();
  return (
    <div>
      <span data-testid="loading">{loading ? 'true' : 'false'}</span>
      <span data-testid="user-id">{user?.id ?? 'none'}</span>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({
    data: {
      session: {
        access_token: 'token-1',
        refresh_token: 'refresh-1',
        user: { id: USER.id },
      },
    },
    error: null,
  });
  mocks.me.mockResolvedValue({ user: USER });
});

describe('AUD-019.3 — AuthProvider ignores TOKEN_REFRESHED (flash prevention)', () => {
  it('keeps user and loading state without re-fetching on TOKEN_REFRESHED', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
    expect(screen.getByTestId('user-id').textContent).toBe(USER.id);
    expect(mocks.me).toHaveBeenCalledTimes(1);

    act(() => {
      mocks.emitAuthState('TOKEN_REFRESHED', { access_token: 'token-2' });
    });

    expect(mocks.me).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('user-id').textContent).toBe(USER.id);
  });

  it('clears user and stops loading on SIGNED_OUT', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('user-id').textContent).toBe(USER.id);
    });

    act(() => {
      mocks.emitAuthState('SIGNED_OUT', null);
    });

    expect(screen.getByTestId('user-id').textContent).toBe('none');
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });
});

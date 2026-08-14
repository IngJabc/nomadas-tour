import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { mockGetDashboard, mockUseAuthUser } = vi.hoisted(() => ({
  mockGetDashboard: vi.fn(),
  mockUseAuthUser: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  agencyApi: {
    getDashboard: () => mockGetDashboard(),
  },
}));

vi.mock('@/hooks/useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}));

vi.mock('@/components/layout/Topbar', () => ({
  Topbar: ({ greeting }: { greeting: string }) => (
    <div data-testid="dashboard-greeting">{greeting}</div>
  ),
}));

vi.mock('@/lib/realtime/subscriptions', () => ({
  subscribeToTripSeats: vi.fn(() => () => {}),
  subscribeToReservations: vi.fn(() => () => {}),
  subscribeToTrips: vi.fn(() => () => {}),
  subscribeToBoardingLogs: vi.fn(() => () => {}),
  subscribeToTripAgencies: vi.fn(() => () => {}),
}));

import AgencyDashboardPage from '@/app/agency/page';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDashboard.mockReturnValue(new Promise(() => {}));
});

describe('Agency dashboard identity', () => {
  it('renders agency_name from auth while dashboard data is still loading', async () => {
    mockUseAuthUser.mockReturnValue({
      user: {
        id: 'user-1',
        email: 'agency@example.com',
        role: 'agency',
        agency_id: 'agency-1',
        agency_name: 'Agencia Central',
      },
      loading: false,
    });

    render(<AgencyDashboardPage />);

    expect(screen.getByTestId('dashboard-greeting').textContent).toContain(
      'Agencia Central',
    );
    await waitFor(() => {
      expect(mockGetDashboard).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps the stable Agencia fallback when identity is unavailable', async () => {
    mockUseAuthUser.mockReturnValue({
      user: null,
      loading: true,
    });

    render(<AgencyDashboardPage />);

    expect(screen.getByTestId('dashboard-greeting').textContent).toMatch(
      /,\sAgencia$/,
    );
    await waitFor(() => {
      expect(mockGetDashboard).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps the Agencia fallback when agency_name is empty/whitespace', async () => {
    mockUseAuthUser.mockReturnValue({
      user: {
        id: 'user-1',
        email: 'agency@example.com',
        role: 'agency',
        agency_id: 'agency-1',
        agency_name: '   ',
      },
      loading: false,
    });

    render(<AgencyDashboardPage />);

    expect(screen.getByTestId('dashboard-greeting').textContent).toMatch(
      /,\sAgencia$/,
    );
    await waitFor(() => {
      expect(mockGetDashboard).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps the auth identity on the greeting after dashboard data loads', async () => {
    mockUseAuthUser.mockReturnValue({
      user: {
        id: 'user-1',
        email: 'agency@example.com',
        role: 'agency',
        agency_id: 'agency-1',
        agency_name: 'Agencia Central',
      },
      loading: false,
    });
    mockGetDashboard.mockResolvedValue({
      total_trips: 0,
      active_trips: 0,
      total_reservations: 0,
      today_reservations: 0,
      pending_boarding_passengers: 0,
      upcoming_trips: [],
      recent_activity: [],
      occupancy_by_trip: [],
      occupancy_alerts: [],
    });

    render(<AgencyDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('dashboard-greeting').textContent).toContain(
        'Agencia Central',
      );
    });
    expect(screen.getByTestId('dashboard-greeting').textContent).not.toMatch(
      /,\sAgencia$/,
    );
    expect(mockGetDashboard).toHaveBeenCalledTimes(1);
  });
});

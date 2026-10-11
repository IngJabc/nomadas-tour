import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTripBuilderReducer } from '@/hooks/useTripBuilderReducer';

describe('TRIP-PRICE-001 — TripBuilderState.seat_price_input', () => {
  it('starts empty (no silent zero)', () => {
    const { result } = renderHook(() => useTripBuilderReducer());
    expect(result.current.state.seat_price_input).toBe('');
  });

  it('SET_SEAT_PRICE_INPUT stores the raw peso text', () => {
    const { result } = renderHook(() => useTripBuilderReducer());

    act(() => {
      result.current.dispatch({ type: 'SET_SEAT_PRICE_INPUT', payload: '250000' });
    });

    expect(result.current.state.seat_price_input).toBe('250000');
  });

  it('LOAD_FROM_TRIP restores the price of an existing trip', () => {
    const { result } = renderHook(() =>
      useTripBuilderReducer({
        route_id: 'route-1',
        departure_time: '2026-12-01T08:00',
        vehicle_type: 'kia',
        agency_ids: ['agency-1'],
        seat_price_input: '300',
      }),
    );

    expect(result.current.state.seat_price_input).toBe('300');
  });

  it('RESET clears the price input', () => {
    const { result } = renderHook(() =>
      useTripBuilderReducer({ seat_price_input: '999' }),
    );

    act(() => {
      result.current.dispatch({ type: 'RESET' });
    });

    expect(result.current.state.seat_price_input).toBe('');
  });

  it('keeps the price when navigating between steps', () => {
    const { result } = renderHook(() => useTripBuilderReducer());

    act(() => {
      result.current.dispatch({ type: 'SET_SEAT_PRICE_INPUT', payload: '1500' });
    });
    act(() => {
      result.current.dispatch({ type: 'NEXT_STEP' });
    });
    act(() => {
      result.current.dispatch({ type: 'PREVIOUS_STEP' });
    });

    expect(result.current.state.seat_price_input).toBe('1500');
  });
});

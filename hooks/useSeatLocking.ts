'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { agencyApi } from '@/lib/api';
import { subscribeToTripSeats } from '@/lib/realtime/subscriptions';
import { Seat, Trip } from '@/types';

interface UseSeatLockingOptions {
  userId: string | null;
  onSeatLost?: (seatCode: string) => void;
}

interface UseSeatLockingReturn {
  selectedTrip: Trip | null;
  seatsMap: Record<string, Seat>;
  selectedSeats: Seat[];
  tripLoading: boolean;
  tripsError: string | null;
  loadTrip: (tripId: string) => Promise<void>;
  loadDeepLinkTrip: (tripId: string) => Promise<boolean>;
  toggleSeat: (seat: Seat, onError: (message: string, type: 'error' | 'info') => void) => void;
  unlockAllCurrent: () => Promise<void>;
  resetSeats: () => void;
  deepLinkError: boolean;
}

export function useSeatLocking({ userId, onSeatLost }: UseSeatLockingOptions): UseSeatLockingReturn {
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [seatsMap, setSeatsMap] = useState<Record<string, Seat>>({});
  const [selectedSeats, setSelectedSeats] = useState<Seat[]>([]);
  const [tripLoading, setTripLoading] = useState(false);
  const [tripsError, setTripsError] = useState<string | null>(null);
  const [deepLinkError, setDeepLinkError] = useState(false);

  const tripIdRef = useRef<string | null>(null);
  const channelRef = useRef<ReturnType<typeof subscribeToTripSeats> | null>(null);
  const selectedSeatsRef = useRef<Seat[]>([]);
  const userIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const onSeatLostRef = useRef(onSeatLost);
  const tokenRef = useRef<string | null>(null);

  selectedSeatsRef.current = selectedSeats;
  userIdRef.current = userId;
  onSeatLostRef.current = onSeatLost;

  // Refresh cached auth token periodically for reliable cleanup on unload
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (active) tokenRef.current = session?.access_token ?? null;
      } catch { /* silent */ }
    };
    refresh();
    const interval = setInterval(refresh, 4 * 60 * 1000); // refresh every 4 min
    return () => { active = false; clearInterval(interval); };
  }, []);

  // Cleanup on unmount — use keepalive fetch for reliable cleanup on tab close/refresh
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const tid = tripIdRef.current;
      if (tid) {
        const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/agency/seats/unlock-all`;
        const token = tokenRef.current;
        try {
          fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ trip_id: tid }),
            keepalive: true,
          }).catch(() => {});
        } catch { /* fetch itself can throw in edge cases */ }
      }
      if (channelRef.current) { channelRef.current(); channelRef.current = null; }
    };
  }, []);

  // ─── Core operations ───────────────────────────────────────────────

  const unlockAllCurrent = useCallback(async () => {
    const tid = tripIdRef.current;
    if (!tid) return;
    try { await agencyApi.unlockAllSeats(tid); } catch { /* silent */ }
  }, []);

  const cleanupChannel = useCallback(() => {
    if (channelRef.current) { channelRef.current(); channelRef.current = null; }
  }, []);

  const buildSeatsMap = useCallback((seats: Seat[]): Record<string, Seat> => {
    const map: Record<string, Seat> = {};
    for (const s of seats) map[s.seat_code] = s;
    return map;
  }, []);

  const resetSeats = useCallback(() => {
    setSelectedSeats([]);
    setSeatsMap({});
  }, []);

  // ─── Load trip ──────────────────────────────────────────────────────

  const loadTrip = useCallback(async (tripId: string) => {
    const prevId = tripIdRef.current;
    if (prevId && prevId !== tripId) {
      try { await agencyApi.unlockAllSeats(prevId); } catch { /* silent */ }
    }
    cleanupChannel();

    setTripLoading(true);
    resetSeats();
    try {
      const trip: Trip = await agencyApi.getTrip(tripId);
      setSelectedTrip(trip);
      setSeatsMap(buildSeatsMap(trip.seats || []));
      tripIdRef.current = tripId;
    } catch (err) {
      setTripsError(err instanceof Error ? err.message : 'Error al cargar el viaje');
    } finally {
      setTripLoading(false);
    }
  }, [cleanupChannel, resetSeats, buildSeatsMap]);

  // ─── Deep link ──────────────────────────────────────────────────────

  const loadDeepLinkTrip = useCallback(async (tripId: string): Promise<boolean> => {
    const prevId = tripIdRef.current;
    if (prevId && prevId !== tripId) {
      try { await agencyApi.unlockAllSeats(prevId); } catch { /* silent */ }
    }
    cleanupChannel();

    setTripLoading(true);
    try {
      const trip: Trip = await agencyApi.getTrip(tripId);
      if (!trip || trip.status === 'completed') {
        setDeepLinkError(true);
        return false;
      }
      setSelectedTrip(trip);
      setSeatsMap(buildSeatsMap(trip.seats || []));
      tripIdRef.current = tripId;
      return true;
    } catch {
      setDeepLinkError(true);
      return false;
    } finally {
      setTripLoading(false);
    }
  }, [cleanupChannel, buildSeatsMap]);

  // ─── Toggle seat ────────────────────────────────────────────────────

  const toggleSeat = useCallback(async (seat: Seat, onError: (message: string, type: 'error' | 'info') => void) => {
    if (seat.status === 'reserved') return;
    if (seat.status === 'locked' && seat.locked_by !== userIdRef.current) return;

    const tripId = tripIdRef.current;
    if (!tripId) return;

    const exists = selectedSeatsRef.current.some((s) => s.id === seat.id);
    if (exists) {
      try {
        await agencyApi.unlockSeat(tripId, seat.id);
        setSelectedSeats((prev) => prev.filter((s) => s.id !== seat.id));
      } catch {
        onError('No se pudo liberar el asiento', 'error');
      }
    } else {
      try {
        await agencyApi.lockSeat(tripId, seat.id);
        setSelectedSeats((prev) => [...prev, seat]);
      } catch {
        onError('Asiento ocupado por otro usuario', 'error');
      }
    }
  }, []);

  // ─── Realtime subscription for seat selection step ──────────────────

  useEffect(() => {
    if (!tripIdRef.current || !selectedTrip?.id) return;
    const tripId = tripIdRef.current;

    const debounceTimerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    const pendingTripIds = new Set<string>();

    const flush = async () => {
      if (pendingTripIds.size === 0 || !mountedRef.current) return;
      const idsToFetch = Array.from(pendingTripIds);
      pendingTripIds.clear();

      for (const tid of idsToFetch) {
        try {
          const fresh: Trip = await agencyApi.getTrip(tid);
          const seats = fresh.seats || [];
          setSeatsMap(buildSeatsMap(seats));
        } catch { /* silent */ }
      }
    };

    const handleSeatUpdate = (seat: any) => {
      const seatTripId = seat.trip_id as string;
      if (!seatTripId || seatTripId !== tripId) return;

      // Immediate local update
      const newSeat = seat as Seat;
      setSeatsMap((prev) => {
        const existing = prev[newSeat.seat_code];
        if (!existing) return prev;
        return { ...prev, [newSeat.seat_code]: { ...existing, ...newSeat } };
      });

      // Deselect if another user locked my seat
      if (newSeat.status === 'locked' && newSeat.locked_by !== userIdRef.current) {
        const wasSelected = selectedSeatsRef.current.some((s) => s.id === newSeat.id);
        setSelectedSeats((sel) => sel.filter((s) => s.id !== newSeat.id));
        if (wasSelected) onSeatLostRef.current?.(newSeat.seat_code);
      }

      // Deselect if my locked seat expired (became available again)
      if (newSeat.status === 'available') {
        const wasMyLockedSeat = selectedSeatsRef.current.some((s) => s.id === newSeat.id);
        if (wasMyLockedSeat) {
          setSelectedSeats((sel) => sel.filter((s) => s.id !== newSeat.id));
          onSeatLostRef.current?.(newSeat.seat_code);
        }
      }

      // Debounced full refetch
      pendingTripIds.add(seatTripId);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(flush, 500);
    };

    cleanupChannel();
    channelRef.current = subscribeToTripSeats([tripId], handleSeatUpdate);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      cleanupChannel();
    };
  }, [selectedTrip?.id, cleanupChannel, buildSeatsMap]);

  return {
    selectedTrip,
    seatsMap,
    selectedSeats,
    tripLoading,
    tripsError,
    loadTrip,
    loadDeepLinkTrip,
    toggleSeat,
    unlockAllCurrent,
    resetSeats,
    deepLinkError,
  };
}

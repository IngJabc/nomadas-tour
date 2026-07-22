'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { agencyApi } from '@/lib/api';
import { subscribeToTripSeats, subscribeToTrips } from '@/lib/realtime/subscriptions';
import { Seat, Trip } from '@/types';

interface UseSeatLockingOptions {
  userId: string | null;
  onSeatLost?: (seatCode: string) => void;
  onTripCancelled?: () => void;
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
  clearSelection: () => void;
  refreshSeats: () => Promise<void>;
  deepLinkError: boolean;
}

export function useSeatLocking({ userId, onSeatLost, onTripCancelled }: UseSeatLockingOptions): UseSeatLockingReturn {
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
  const onTripCancelledRef = useRef(onTripCancelled);
  const tripCancelledRef = useRef(false);
  const tokenRef = useRef<string | null>(null);
  const unlockSentRef = useRef(false);

  selectedSeatsRef.current = selectedSeats;
  userIdRef.current = userId;
  onSeatLostRef.current = onSeatLost;
  onTripCancelledRef.current = onTripCancelled;

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

  // ─── Unlock keepalive ────────────────────────────────────────────────
  // Shared function for both beforeunload and React cleanup.
  // unlockSentRef prevents double execution (beforeunload fires first,
  // then React cleanup fires during teardown — the ref skips the second).

  const sendUnlockKeepalive = useCallback(() => {
    if (unlockSentRef.current) return;
    const tid = tripIdRef.current;
    if (!tid) return;
    unlockSentRef.current = true;
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
  }, []);

  // beforeunload — send keepalive unlock BEFORE browser destroys the page.
  // This is the reliable path for F5 refresh and tab close.
  useEffect(() => {
    window.addEventListener('beforeunload', sendUnlockKeepalive);
    return () => window.removeEventListener('beforeunload', sendUnlockKeepalive);
  }, [sendUnlockKeepalive]);

  // Cleanup on unmount — fallback for in-app navigation (soft navigation).
  // During soft nav the page context is alive, so keepalive completes reliably.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sendUnlockKeepalive();
      if (channelRef.current) { channelRef.current(); channelRef.current = null; }
    };
  }, [sendUnlockKeepalive]);

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

  const clearSelection = useCallback(() => {
    setSelectedSeats([]);
  }, []);

  const refreshSeats = useCallback(async () => {
    const tid = tripIdRef.current;
    if (!tid) return;
    try {
      const fresh: Trip = await agencyApi.getTrip(tid);
      setSeatsMap(buildSeatsMap(fresh.seats || []));
    } catch { /* silent */ }
  }, [buildSeatsMap]);

  // ─── Load trip ──────────────────────────────────────────────────────

  const loadTrip = useCallback(async (tripId: string) => {
    const prevId = tripIdRef.current;
    if (prevId && prevId !== tripId) {
      try { await agencyApi.unlockAllSeats(prevId); } catch { /* silent */ }
    }
    cleanupChannel();
    tripCancelledRef.current = false;
    unlockSentRef.current = false;

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
    tripCancelledRef.current = false;
    unlockSentRef.current = false;

    setTripLoading(true);
    try {
      const trip: Trip = await agencyApi.getTrip(tripId);
      if (!trip || trip.status === 'completed' || trip.status === 'cancelled') {
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
        const result = await agencyApi.lockSeat(tripId, seat.id);
        setSelectedSeats((prev) => [...prev, { ...seat, locked_at: result.locked_at }]);
      } catch {
        try { await refreshSeats(); } catch { /* silent */ }
        onError('Asiento ocupado por otro usuario', 'error');
      }
    }
  }, [refreshSeats]);

  // ─── Realtime subscription for seat selection step ──────────────────

  useEffect(() => {
    console.log('[RT:effect] selectedTrip?.id:', selectedTrip?.id, '| tripIdRef:', tripIdRef.current);
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
          const lockedSeats = seats.filter((s: any) => s.status === 'locked');
          console.log('[RT:flush] trip:', tid, '| total_seats:', seats.length, '| locked_seats:', lockedSeats.length, lockedSeats.map((s: any) => `${s.seat_code}(${s.locked_by})`).join(', '));
          setSeatsMap(buildSeatsMap(seats));
        } catch { /* silent */ }
      }
    };

    const handleSeatUpdate = ({ seat }: { seat: any }) => {
      console.log('[RT:handleSeatUpdate] seat_code:', seat?.seat_code, '| status:', seat?.status, '| locked_by:', seat?.locked_by, '| trip_id:', seat?.trip_id);
      const seatTripId = seat.trip_id as string;
      if (!seatTripId || seatTripId !== tripId) return;

      // Immediate local update
      const newSeat = seat as Seat;
      setSeatsMap((prev) => {
        const existing = prev[newSeat.seat_code];
        console.log('[RT:setSeatsMap] seat_code:', newSeat.seat_code, '| exists:', !!existing, '| current_status:', existing?.status, '| new_status:', newSeat.status, '| locked_by:', newSeat.locked_by);
        if (!existing) return prev;
        return { ...prev, [newSeat.seat_code]: { ...existing, ...newSeat } };
      });

      // Deselect if another user locked my seat
      if (newSeat.status === 'locked' && newSeat.locked_by !== userIdRef.current) {
        const wasSelected = selectedSeatsRef.current.some((s) => s.id === newSeat.id);
        setSelectedSeats((sel) => sel.filter((s) => s.id !== newSeat.id));
        if (wasSelected && !tripCancelledRef.current) onSeatLostRef.current?.(newSeat.seat_code);
      }

      // Deselect if my locked seat expired (became available again)
      if (newSeat.status === 'available') {
        const wasMyLockedSeat = selectedSeatsRef.current.some((s) => s.id === newSeat.id);
        if (wasMyLockedSeat) {
          setSelectedSeats((sel) => sel.filter((s) => s.id !== newSeat.id));
          if (!tripCancelledRef.current) onSeatLostRef.current?.(newSeat.seat_code);
        }
      }

      // Debounced full refetch
      pendingTripIds.add(seatTripId);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(flush, 500);
    };

    cleanupChannel();
    console.log('[RT:subscribing] tripId:', tripId, '| creating channel...');
    channelRef.current = subscribeToTripSeats([tripId], handleSeatUpdate);
    console.log('[RT:subscribing] channel created:', typeof channelRef.current);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      cleanupChannel();
    };
  }, [selectedTrip?.id, cleanupChannel, buildSeatsMap]);

  // ─── Realtime: detect trip cancellation ─────────────────────────────
  useEffect(() => {
    if (!tripIdRef.current || !selectedTrip?.id) return;
    const tripId = tripIdRef.current;

    const cleanup = subscribeToTrips((payload) => {
      if (payload.eventType !== 'UPDATE') return;
      const trip = payload.trip;
      if (trip.id !== tripId) return;
      if (trip.status === 'cancelled') {
        tripCancelledRef.current = true;
        onTripCancelledRef.current?.();
      }
    }, [tripId]);

    return cleanup;
  }, [selectedTrip?.id]);

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
    clearSelection,
    refreshSeats,
    deepLinkError,
  };
}

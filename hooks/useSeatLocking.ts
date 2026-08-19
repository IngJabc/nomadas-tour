'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { agencyApi } from '@/lib/api';
import { subscribeToTripSeats, subscribeToTrips } from '@/lib/realtime/subscriptions';
import { Seat, Trip } from '@/types';

export interface TripFieldChanges {
  route_id: boolean;
  departure_time: boolean;
  vehicle_type: boolean;
  capacity: boolean;
}

interface UseSeatLockingOptions {
  userId: string | null;
  onSeatLost?: (seatCode: string) => void;
  onTripCancelled?: () => void;
  onTripCompleted?: () => void;
  onTripUpdated?: (changes: TripFieldChanges) => void;
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
  retainLocksOnUnmount: () => void;
  applyLockExpiresAt: (expiresAt: string) => void;
  resetSeats: () => void;
  clearSelection: () => void;
  refreshSeats: () => Promise<void>;
  syncSeatsAfterCancel: () => Promise<void>;
  deepLinkError: boolean;
}

export function useSeatLocking({ userId, onSeatLost, onTripCancelled, onTripCompleted, onTripUpdated }: UseSeatLockingOptions): UseSeatLockingReturn {
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
  const onTripCompletedRef = useRef(onTripCompleted);
  const onTripUpdatedRef = useRef(onTripUpdated);
  const tripCancelledRef = useRef(false);
  const tokenRef = useRef<string | null>(null);
  const unlockSentRef = useRef(false);
  const retainLocksRef = useRef(false);
  const prevTripFieldsRef = useRef<{
    route_id: string | null;
    departure_time: string | null;
    vehicle_type: string | null;
    capacity: number | null;
    status: string | null;
  }>({ route_id: null, departure_time: null, vehicle_type: null, capacity: null, status: null });

  selectedSeatsRef.current = selectedSeats;
  userIdRef.current = userId;
  onSeatLostRef.current = onSeatLost;
  onTripCancelledRef.current = onTripCancelled;
  onTripCompletedRef.current = onTripCompleted;
  onTripUpdatedRef.current = onTripUpdated;

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
    if (retainLocksRef.current) return;
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

  const retainLocksOnUnmount = useCallback(() => {
    retainLocksRef.current = true;
  }, []);

  const applyLockExpiresAt = useCallback((expiresAt: string) => {
    setSelectedSeats((prev) =>
      prev.map((s) => ({ ...s, lock_expires_at: expiresAt })),
    );
  }, []);

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

  /** Refetch seats and drop any that were released by a cancelled link. */
  const syncSeatsAfterCancel = useCallback(async () => {
    const tid = tripIdRef.current;
    if (!tid) return;
    try {
      const fresh: Trip = await agencyApi.getTrip(tid);
      setSeatsMap(buildSeatsMap(fresh.seats || []));
      setSelectedSeats((prev) =>
        prev.filter((s) => {
          const freshSeat = (fresh.seats || []).find((fs) => fs.id === s.id);
          return freshSeat && freshSeat.status === 'locked' && freshSeat.locked_by === userIdRef.current;
        }),
      );
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
      prevTripFieldsRef.current = {
        route_id: trip.route_id,
        departure_time: trip.departure_time,
        vehicle_type: trip.vehicle_type,
        capacity: trip.capacity,
        status: trip.status,
      };
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
      prevTripFieldsRef.current = {
        route_id: trip.route_id,
        departure_time: trip.departure_time,
        vehicle_type: trip.vehicle_type,
        capacity: trip.capacity,
        status: trip.status,
      };
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
        setSelectedSeats((prev) => [
          ...prev,
          {
            ...seat,
            locked_at: result.locked_at,
            lock_expires_at: result.lock_expires_at ?? null,
          },
        ]);
      } catch {
        try { await refreshSeats(); } catch { /* silent */ }
        onError('Asiento ocupado por otro usuario', 'error');
      }
    }
  }, [refreshSeats]);

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

    const handleSeatUpdate = ({ seat }: { seat: any }) => {
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
    channelRef.current = subscribeToTripSeats([tripId], handleSeatUpdate);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      cleanupChannel();
    };
  }, [selectedTrip?.id, cleanupChannel, buildSeatsMap]);

  // ─── Realtime: detect trip updates ─────────────────────────────────
  useEffect(() => {
    if (!tripIdRef.current || !selectedTrip?.id) return;
    const tripId = tripIdRef.current;

    const cleanup = subscribeToTrips((payload) => {
      if (payload.eventType !== 'UPDATE') return;
      const trip = payload.trip;
      if (trip.id !== tripId) return;

      const prev = prevTripFieldsRef.current;

      // Status: cancelled
      if (trip.status === 'cancelled') {
        tripCancelledRef.current = true;
        onTripCancelledRef.current?.();
        return;
      }

      // Status: completed
      if (trip.status === 'completed' && prev.status !== 'completed') {
        onTripCompletedRef.current?.();
        return;
      }

      // Detect relevant field changes
      const changes: TripFieldChanges = {
        route_id: prev.route_id !== null && trip.route_id !== prev.route_id,
        departure_time: prev.departure_time !== null && trip.departure_time !== prev.departure_time,
        vehicle_type: prev.vehicle_type !== null && trip.vehicle_type !== prev.vehicle_type,
        capacity: prev.capacity !== null && trip.capacity !== prev.capacity,
      };

      const hasChanges = Object.values(changes).some(Boolean);
      if (!hasChanges) return;

      // Refetch trip to get fresh data + seats
      agencyApi.getTrip(tripId).then((fresh) => {
        setSelectedTrip(fresh);
        setSeatsMap(buildSeatsMap(fresh.seats || []));

        // Clear selected seats that no longer exist (e.g. vehicle_type changed)
        const newMap = buildSeatsMap(fresh.seats || []);
        setSelectedSeats((prev) => {
          const valid = prev.filter((s) => newMap[s.seat_code]);
          return valid;
        });

        prevTripFieldsRef.current = {
          route_id: fresh.route_id,
          departure_time: fresh.departure_time,
          vehicle_type: fresh.vehicle_type,
          capacity: fresh.capacity,
          status: fresh.status,
        };

        onTripUpdatedRef.current?.(changes);
      }).catch(() => {});
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
    retainLocksOnUnmount,
    applyLockExpiresAt,
    resetSeats,
    clearSelection,
    refreshSeats,
    syncSeatsAfterCancel,
    deepLinkError,
  };
}

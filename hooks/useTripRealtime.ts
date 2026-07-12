'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { adminApi } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { Seat } from '@/types';

export interface TripRealtimeState {
  trip: any | null;
  seats: Record<string, Seat>;
  reservations: any[];
  passengers: any[];
  agencies: { id: string; name: string; count: number; boarded: number }[];
  seatInfo: Record<string, { passengerName?: string; agencyName?: string }>;
  stats: { total: number; available: number; reserved: number; boarded: number };
  loading: boolean;
  error: string | null;
}

export function useTripRealtime(tripId: string): TripRealtimeState {
  const [trip, setTrip] = useState<any | null>(null);
  const [seats, setSeats] = useState<Record<string, Seat>>({});
  const [reservations, setReservations] = useState<any[]>([]);
  const [passengers, setPassengers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(0);
  const resIdRef = useRef<Set<string>>(new Set());

  const fetchTrip = useCallback(async () => {
    if (!tripId) return;
    const id = ++fetchRef.current;
    try {
      const data = await adminApi.getTrip(tripId);
      if (id !== fetchRef.current) return;

      const seatsMap: Record<string, Seat> = {};
      for (const seat of data.seats || []) {
        seatsMap[seat.seat_code] = seat as Seat;
      }

      const allPassengers: any[] = [];
      for (const r of data.reservations || []) {
        for (const p of r.passengers || []) {
          allPassengers.push({
            ...p,
            reservation_id: r.id,
            agency_id: r.agency_id,
            booker_name: r.booker_name,
            status: r.status,
          });
        }
      }

      setTrip(data);
      setSeats(seatsMap);
      setReservations(data.reservations || []);
      setPassengers(allPassengers);
      resIdRef.current = new Set((data.reservations || []).map((r: any) => r.id));
      setError(null);
    } catch (err) {
      if (id !== fetchRef.current) return;
      setError(err instanceof Error ? err.message : 'Error al cargar viaje');
    } finally {
      if (id === fetchRef.current) setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    if (!tripId) return;
    fetchTrip();
  }, [tripId, fetchTrip]);

  // Realtime: seats
  useEffect(() => {
    if (!tripId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`admin-trip-seats:${tripId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'seats',
          filter: `trip_id=eq.${tripId}`,
        },
        (payload: RealtimePostgresChangesPayload<any>) => {
          const s = payload.new as Seat;
          if (!s?.seat_code) return;
          setSeats((prev) => ({ ...prev, [s.seat_code]: s }));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tripId]);

  // Realtime: reservations
  useEffect(() => {
    if (!tripId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`admin-trip-reservations:${tripId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reservations',
          filter: `trip_id=eq.${tripId}`,
        },
          (payload) => {
            fetchTrip();
          },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tripId, fetchTrip]);

  // Realtime: reservation_passengers (for boarded changes)
  // Usa ref para los reservation_ids — no depende del state, evita race conditions
  useEffect(() => {
    if (!tripId) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`admin-trip-passengers:${tripId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reservation_passengers',
        },
        (payload: RealtimePostgresChangesPayload<any>) => {
          const p = payload as any;
          const resId = p.new?.reservation_id || p.old?.reservation_id;
          if (!resId || !resIdRef.current.has(resId)) return;

          if (p.eventType === 'UPDATE' && p.new) {
            setPassengers((prev) =>
              prev.map((px) =>
                px.id === p.new.id
                  ? { ...px, boarded: p.new.boarded }
                  : px,
              ),
            );
          } else if (p.eventType === 'INSERT' || p.eventType === 'DELETE') {
            fetchTrip();
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tripId, fetchTrip]);

  const seatInfo: Record<string, { passengerName?: string; agencyName?: string }> = {};
  const agencyMap = new Map<string, string>();
  if (trip?.trip_agencies) {
    for (const ta of trip.trip_agencies) {
      agencyMap.set(ta.agency_id, ta.agency_name || '');
    }
  }
  for (const p of passengers) {
    if (p.seats?.seat_code) {
      seatInfo[p.seats.seat_code] = {
        passengerName: p.name,
        agencyName: agencyMap.get(p.agency_id) || '',
      };
    }
  }

  // Agency breakdown
  const agencyCounts: Record<string, { count: number; boarded: number }> = {};
  for (const ta of trip?.trip_agencies || []) {
    agencyCounts[ta.agency_id] = { count: 0, boarded: 0 };
  }
  for (const p of passengers) {
    if (p.agency_id && agencyCounts[p.agency_id]) {
      agencyCounts[p.agency_id].count++;
      if (p.boarded) agencyCounts[p.agency_id].boarded++;
    }
  }
  const agencies = (trip?.trip_agencies || []).map((ta: any) => ({
    id: ta.agency_id,
    name: ta.agency_name || '',
    count: agencyCounts[ta.agency_id]?.count || 0,
    boarded: agencyCounts[ta.agency_id]?.boarded || 0,
  }));

  // Stats from seats
  const allSeats = Object.values(seats);
  const stats = {
    total: allSeats.length,
    available: allSeats.filter((s) => s.status === 'available').length,
    reserved: allSeats.filter((s) => s.status === 'reserved').length,
    boarded: passengers.filter((p) => p.boarded).length,
  };

  return { trip, seats, reservations, passengers, agencies, seatInfo, stats, loading, error };
}

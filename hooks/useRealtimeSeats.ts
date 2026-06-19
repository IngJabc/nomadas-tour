'use client';

import { useEffect, useState } from 'react';
import { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { Seat, SeatStatus } from '@/types';

export function useRealtimeSeats(tripId: string) {
  const [seats, setSeats] = useState<Record<string, Seat>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    if (!tripId) return;

    const fetchSeats = async () => {
      try {
        setLoading(true);
        const { data, error: fetchError } = await supabase
          .from('seats')
          .select('*')
          .eq('trip_id', tripId);

        if (fetchError) throw fetchError;

        const seatsMap: Record<string, Seat> = {};
        for (const seat of data ?? []) {
          seatsMap[seat.seat_code] = seat as Seat;
        }
        // Debug: show fetched seats count
        // eslint-disable-next-line no-console
        console.debug('[useRealtimeSeats] fetched seats:', Object.keys(seatsMap).length);
        setSeats(seatsMap);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar asientos');
      } finally {
        setLoading(false);
      }
    };

    fetchSeats();

    const channel = supabase
      .channel(`seats:trip_id=eq.${tripId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'seats',
          filter: `trip_id=eq.${tripId}`,
        },
        (payload: RealtimePostgresChangesPayload<Seat>) => {
          const updatedSeat = payload.new as Seat;
          // Debug: log realtime payload for seat updates
          // eslint-disable-next-line no-console
          console.debug('[useRealtimeSeats] realtime update:', updatedSeat?.seat_code, updatedSeat?.status, 'locked_by=', updatedSeat?.locked_by);
          setSeats((prev) => ({
            ...prev,
            [updatedSeat.seat_code]: updatedSeat,
          }));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId, supabase]);

  const updateSeatStatus = async (
    seatCode: string,
    newStatus: SeatStatus,
  ): Promise<boolean> => {
    try {
      const { error: updateError } = await supabase
        .from('seats')
        .update({
          status: newStatus,
          locked_by: newStatus === 'locked' ? (await supabase.auth.getUser()).data.user?.id : null,
          locked_at: newStatus === 'locked' ? new Date().toISOString() : null,
        })
        .eq('trip_id', tripId)
        .eq('seat_code', seatCode)
        .eq('status', 'available');

      if (updateError) throw updateError;
      return true;
    } catch {
      return false;
    }
  };

  return { seats, loading, error, updateSeatStatus };
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { useRealtimeSeats } from '@/hooks/useRealtimeSeats';
import { BusLayout } from '@/components/bus/BusLayout';
import { SeatLegend } from '@/components/bus/SeatLegend';
import { BookingPanel } from '@/components/booking/BookingPanel';
import { createClient } from '@/lib/supabase/client';
import { Seat } from '@/types';

interface TripClientProps {
  tripId: string;
  price: number;
  totalSeats: number;
  origin?: string;
  destination?: string;
}

export function TripClient({ tripId, price, totalSeats, origin, destination }: TripClientProps) {
  const { seats, loading } = useRealtimeSeats(tripId);
  const [selectedSeats, setSelectedSeats] = useState<Seat[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const myLocalLocks = useRef<Set<string>>(new Set());
  const selectedSeatsRef = useRef<Seat[]>([]);
  const clearedSeatsRef = useRef<Set<string>>(new Set());
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    selectedSeatsRef.current = selectedSeats;
  }, [selectedSeats]);

  useEffect(() => {
    const getUserId = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUserId = user?.id;

      setSelectedSeats((prev) =>
        prev.filter((s) => {
          const updated = seats[s.seat_code];
          if (!updated) return true;
          if (updated.status === 'available') return true;
          if (updated.status === 'locked' && updated.locked_by === currentUserId) return true;
          return false;
        }),
      );
    };
    getUserId();
  }, [seats, supabase]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!mounted) return;
        setUserId(data.user?.id ?? null);
        setAuthLoading(false);
      } catch {
        setUserId(null);
        setAuthLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  useEffect(() => {
    if (!userId) return;

    if (clearedSeatsRef.current.size > 0) {
      for (const seatCode of clearedSeatsRef.current) {
        const live = seats[seatCode];
        if (live && live.status !== 'locked') {
          clearedSeatsRef.current.delete(seatCode);
        }
      }
    }

    setSelectedSeats((prev) => {
      const filtered = prev.filter((s) => {
        const live = seats[s.seat_code];
        if (!live) return false;
        if (live.status === 'available') {
          clearedSeatsRef.current.delete(s.seat_code);
          return myLocalLocks.current.has(s.id);
        }
        if (live.status === 'reserved') return false;
        if (live.status === 'locked') {
          if (live.locked_by) {
            return live.locked_by === userId;
          }
          return myLocalLocks.current.has(s.id);
        }
        return false;
      });

      const existingCodes = new Set(filtered.map((s) => s.seat_code));
      const restored = Object.values(seats).filter(
        (s) =>
          s.status === 'locked' &&
          s.locked_by === userId &&
          !existingCodes.has(s.seat_code) &&
          !clearedSeatsRef.current.has(s.seat_code),
      );

      if (restored.length === 0) return filtered;
      restored.forEach((s) => myLocalLocks.current.add(s.id));
      return [...filtered, ...restored];
    });
  }, [seats, userId]);

  const releaseLocks = async (seatIds: string[]): Promise<void> => {
    if (seatIds.length === 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from('seats')
      .update({ status: 'available', locked_by: null, locked_at: null })
      .in('id', seatIds)
      .eq('locked_by', user.id);
  };

  const toggleSeat = async (seat: Seat) => {
    if (!seat.id) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error('Debes iniciar sesión para seleccionar asientos', { id: 'login-required' });
      return;
    }
    setUserId(user.id);

    const isDeselecting = selectedSeats.some((s) => s.seat_code === seat.seat_code);

    if (isDeselecting) {
      setSelectedSeats((prev) => prev.filter((s) => s.seat_code !== seat.seat_code));
      myLocalLocks.current.delete(seat.id);
      await releaseLocks([seat.id]);
      return;
    }

    if (seat.status !== 'available') return;

    setSelectedSeats((prev) => {
      if (prev.some((s) => s.seat_code === seat.seat_code)) return prev;
      return [...prev, seat];
    });
    myLocalLocks.current.add(seat.id);

    const { data: updatedRows, error: updateError } = await supabase
      .from('seats')
      .update({ status: 'locked', locked_by: user.id, locked_at: new Date().toISOString() })
      .eq('id', seat.id)
      .eq('status', 'available')
      .select();

    if (updateError || !updatedRows || updatedRows.length === 0) {
      myLocalLocks.current.delete(seat.id);
      setSelectedSeats((prev) => prev.filter((s) => s.seat_code !== seat.seat_code));
      toast.error('Este asiento ya no está disponible', { id: 'lock-failed' });
    }
  };

  const handleSuccess = (bookingIds: string[]) => {
    myLocalLocks.current = new Set();
    clearedSeatsRef.current = new Set();
  };

  const handleClear = async () => {
    const seatsToRelease = selectedSeatsRef.current;
    if (seatsToRelease.length === 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSelectedSeats([]);
      return;
    }
    seatsToRelease.forEach((s) => clearedSeatsRef.current.add(s.seat_code));
    const seatIds = seatsToRelease.map((s) => s.id);
    myLocalLocks.current = new Set();
    setSelectedSeats([]);
    await supabase
      .from('seats')
      .update({ status: 'available', locked_by: null, locked_at: null })
      .in('id', seatIds)
      .eq('locked_by', user.id);
  };

  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: '#f1f5f9' }}>
        <div className="max-w-7xl mx-auto" style={{ padding: '32px 24px' }}>
          <div className="flex flex-col lg:flex-row gap-8 items-start justify-center animate-pulse">
            <div className="flex flex-col items-center gap-6">
              <div className="bg-white rounded-2xl p-4" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
                <div style={{ background: 'var(--color-brand-dark)', borderRadius: 20, padding: 16 }}>
                  <div className="flex justify-center mb-4">
                    <div className="w-20 h-10 bg-slate-600 rounded-t-2xl" />
                  </div>
                  <div className="space-y-2">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="flex gap-8 items-center">
                        <div className="flex gap-1">
                          {Array.from({ length: 3 }).map((_, j) => (
                            <div key={j} className="w-10 h-10 rounded-xl bg-slate-500" />
                          ))}
                        </div>
                        <div className="w-6" />
                        <div className="flex gap-1">
                          {Array.from({ length: 3 }).map((_, j) => (
                            <div key={j} className="w-10 h-10 rounded-xl bg-slate-500" />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="w-full lg:w-80">
              <div className="bg-white rounded-2xl p-6 space-y-4" style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>
                <div className="h-6 bg-slate-200 rounded-lg w-1/2" />
                <div className="h-4 bg-slate-200 rounded-lg w-3/4" />
                <div className="h-4 bg-slate-200 rounded-lg w-1/3" />
                <div className="h-10 bg-slate-200 rounded-xl" />
                <div className="h-10 bg-slate-200 rounded-xl" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isNotLoggedIn = !authLoading && !userId;

  return (
    <div className="min-h-screen" style={{ background: '#f1f5f9' }}>
      <div className="max-w-7xl mx-auto" style={{ padding: '32px 24px' }}>
        <div className="pt-12">
          {/* Not logged in alert (spec: only if not authenticated) */}
          {isNotLoggedIn && (
            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fcd34d',
                borderRadius: 10,
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 24,
              }}
            >
              <span style={{ fontSize: 16 }}>⚠️</span>
              <p style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 13, color: '#92400e' }}>
                Necesitas{' '}
                <Link href="/login" style={{ color: 'var(--color-brand-cyan)', fontWeight: 600, textDecoration: 'none' }}>
                  iniciar sesión
                </Link>{' '}
                para seleccionar y reservar asientos
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 lg:gap-8 items-start">
            <div className="flex flex-col items-center gap-4 min-w-0">
              <SeatLegend />
              <BusLayout
                seats={seats}
                selectedSeats={selectedSeats}
                onToggleSeat={toggleSeat}
                totalSeats={totalSeats}
              />
            </div>
            <aside className="lg:sticky lg:top-20 self-start w-full">
              <BookingPanel
                selectedSeats={selectedSeats}
                tripId={tripId}
                price={price}
                onSuccess={handleSuccess}
                onClear={handleClear}
                onReleaseLocks={releaseLocks}
              />
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

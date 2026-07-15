'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Bus, AlertTriangle } from 'lucide-react';
import { agencyApi } from '@/lib/api';
import { subscribeToTripSeats } from '@/lib/realtime/subscriptions';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { AgencyTripCard, type AgencyTrip } from '@/components/agency/AgencyTripCard';
import { pageFade, staggerContainer, staggerItem } from '@/lib/motion/variants';

export default function AgencyTripsPage() {
  const [trips, setTrips] = useState<AgencyTrip[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [tripIds, setTripIds] = useState<string[]>([]);

  const doFetch = useCallback(async () => {
    try {
      setFetchError(null);
      const data = await agencyApi.getTrips();
      setTrips(data);
      setTripIds(data.map((t: AgencyTrip) => t.id));
    } catch {
      setFetchError('No se pudieron cargar los viajes. Intenta de nuevo.');
    } finally {
      setInitialLoad(false);
    }
  }, []);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  // Realtime: suscribirse a cambios de asientos con debounce y agrupación por trip_id
  useEffect(() => {
    if (!tripIds.length) return;

    const debounceTimerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    const pendingTripIds = new Set<string>();

    const flush = async () => {
      if (pendingTripIds.size === 0) return;
      const idsToFetch = Array.from(pendingTripIds);
      pendingTripIds.clear();

      for (const tripId of idsToFetch) {
        try {
          const fresh = await agencyApi.getTrip(tripId);
          const seats = fresh.seats ?? [];
          const available_seats = seats.filter((s: any) => s.status === 'available').length;
          const reserved_seats = seats.filter((s: any) => s.status === 'reserved' || s.status === 'boarded').length;

          setTrips((prev) => {
            const idx = prev.findIndex((t) => t.id === tripId);
            if (idx === -1) return prev;
            const updated = [...prev];
            updated[idx] = { ...updated[idx], available_seats, reserved_seats };
            return updated;
          });
        } catch {
          // silently keep current state on realtime refetch error
        }
      }
    };

    const handleSeatUpdate = (seat: any) => {
      const tripId = seat.trip_id as string;
      if (!tripId) return;

      pendingTripIds.add(tripId);

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(flush, 500);
    };

    const cleanup = subscribeToTripSeats(tripIds, handleSeatUpdate);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      cleanup();
    };
  }, [tripIds]);

  // ─── Loading skeleton ─────────────────────────────────────────────────
  if (initialLoad) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="h-8 w-40 bg-slate-200 rounded animate-pulse mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => <CardSkeleton key={i} />)}
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <motion.div
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25 }}
      >
        <PageHeader title="Mis viajes" />
      </motion.div>

      {fetchError && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2]"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-[#ef4444] shrink-0" strokeWidth={1.75} />
            <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444]">{fetchError}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={doFetch}>
            Reintentar
          </Button>
        </motion.div>
      )}

      {trips.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25 }}
        >
          <EmptyState
            icon={<Bus className="w-8 h-8" />}
            message="No tienes viajes asignados todavía"
          />
        </motion.div>
      ) : (
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {trips.map((trip) => (
            <motion.div key={trip.id} variants={staggerItem}>
              <AgencyTripCard trip={trip} />
            </motion.div>
          ))}
        </motion.div>
      )}
    </main>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Bus } from 'lucide-react';
import { agencyApi } from '@/lib/api';
import { subscribeToTripSeats } from '@/lib/realtime/subscriptions';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { AgencyTripCard, type AgencyTrip } from '@/components/agency/AgencyTripCard';

export default function AgencyTripsPage() {
  const [trips, setTrips] = useState<AgencyTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tripIds, setTripIds] = useState<string[]>([]);

  useEffect(() => {
    const fetch = async () => {
      try {
        const data = await agencyApi.getTrips();
        setTrips(data);
        setTripIds(data.map((t: AgencyTrip) => t.id));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar viajes');
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  // Realtime: suscribirse a cambios de asientos una vez cargados los viajes
  useEffect(() => {
    if (!tripIds.length) return;

    console.log('[AgencyTrips] Realtime effect — creando suscripcion', {
      tripIdsCount: tripIds.length,
      tripIds,
    });

    const cleanup = subscribeToTripSeats(tripIds, (seat) => {
      const tripId = seat.trip_id as string;
      if (!tripId) return;

      console.log('[AgencyTrips] Realtime callback ejecutado', {
        tripId,
        seat_code: seat.seat_code,
        status: seat.status,
        timestamp: new Date().toISOString(),
      });

      console.log('[AgencyTrips] getTrip — solicitando', { tripId });

      agencyApi.getTrip(tripId).then((fresh) => {
        console.log('[AgencyTrips] getTrip — respuesta recibida', {
          tripId,
          httpStatus: '200',
          data: JSON.parse(JSON.stringify(fresh)),
        });

        const seats = fresh.seats ?? [];
        const available_seats = seats.filter((s: any) => s.status === 'available').length;
        const reserved_seats = seats.filter((s: any) => s.status === 'reserved' || s.status === 'boarded').length;

        console.log('[AgencyTrips] calculation — counts desde fresh.seats', {
          tripId,
          totalSeats: seats.length,
          available: seats.filter((s: any) => s.status === 'available').length,
          locked: seats.filter((s: any) => s.status === 'locked').length,
          reserved: seats.filter((s: any) => s.status === 'reserved').length,
          blocked: seats.filter((s: any) => s.status === 'blocked').length,
          guide: seats.filter((s: any) => s.status === 'guide').length,
          boarded: seats.filter((s: any) => s.status === 'boarded').length,
          rawStatuses: seats.map((s: any) => s.status),
        });

        setTrips((prev) => {
          const idx = prev.findIndex((t) => t.id === tripId);
          const found = idx !== -1;
          const availableAnterior = found ? prev[idx].available_seats : undefined;
          const reservedAnterior = found ? prev[idx].reserved_seats : undefined;

          console.log('[AgencyTrips] setTrips', {
            tripId,
            tripFoundInArray: found ? 'SI' : 'NO',
            availableAnterior,
            reservedAnterior,
            availableNuevo: available_seats,
            reservedNuevo: reserved_seats,
          });

          if (!found) return prev;
          const updated = [...prev];
          updated[idx] = { ...updated[idx], available_seats, reserved_seats };
          return updated;
        });
      }).catch((err) => {
        console.log('[AgencyTrips] getTrip — ERROR', {
          tripId,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      });
    });

    return () => {
      console.log('[AgencyTrips] cleanup — ejecutado', {
        motivo: 'unmount o cambio de tripIds',
        tripIdsLength: tripIds.length,
      });
      cleanup();
    };
  }, [tripIds]);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <PageHeader
        title="Mis viajes"
        breadcrumbs={[{ label: 'Agencia', href: '/agency' }]}
      />

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 font-[family-name:var(--font-body)] text-sm text-red-600">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4">
          {[1, 2, 3].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : trips.length === 0 ? (
        <EmptyState
          icon={<Bus className="w-8 h-8" />}
          message="No tienes viajes asignados todavía"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {trips.map((trip) => (
            <AgencyTripCard key={trip.id} trip={trip} />
          ))}
        </div>
      )}
    </main>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { BuilderLayout } from '@/components/admin/trip-builder/BuilderLayout';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { adminApi } from '@/lib/api';
import { fromUTCToLocal } from '@/lib/timezone';
import type { TripBuilderState } from '@/hooks/useTripBuilderReducer';
import { staggerContainer, staggerItem } from '@/lib/motion/variants';

export default function EditTripPage() {
  const params = useParams();
  const router = useRouter();
  const tripId = params.tripId as string;
  const [initialData, setInitialData] = useState<Partial<TripBuilderState>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tripId) return;

    const load = async () => {
      try {
        const trip = await adminApi.getTrip(tripId);
        setInitialData({
          route_id: trip.route_id,
          departure_time: trip.departure_time
            ? fromUTCToLocal(trip.departure_time)
            : '',
          vehicle_type: trip.vehicle_type ?? 'bus',
          agency_ids: (trip.trip_agencies || []).map((a: any) => a.agency_id),
        });
      } catch {
        setError('No se pudo cargar el viaje');
      }
      setLoading(false);
    };

    load();
  }, [tripId]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={staggerItem}>
            <CardSkeleton />
          </motion.div>
        </motion.div>
      </div>
    );
  }

  if (error || !initialData) {
    router.push('/admin/trips');
    return null;
  }

  return (
    <BuilderLayout
      mode="edit"
      tripId={tripId}
      initialData={initialData}
      onSuccess={() => router.push('/admin/trips')}
    />
  );
}

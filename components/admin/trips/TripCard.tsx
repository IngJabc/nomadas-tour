'use client';

import { forwardRef, useRef, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bus, MapPin, Calendar } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { formatDateTime } from '@/lib/utils';
import { TripStatusBadge } from './TripStatusBadge';
import { TripOccupancy } from './TripOccupancy';
import { TripAgencies } from './TripAgencies';
import { TripActions } from './TripActions';

const VEHICLE_LABELS: Record<string, string> = {
  bus: 'Autobús',
  kia: 'KIA',
};

interface TripCardProps {
  trip: {
    id: string;
    route: { origin: string; destination: string };
    departure_time: string;
    vehicle: { type: 'bus' | 'kia'; capacity: number };
    status: string;
    postponed_from: string | null;
    occupancy: { total: number; available: number; reserved: number; locked: number; blocked: number; boarded: number };
    agencies: { id: string; name: string; reservation_count: number }[];
  };
  onEdit: (id: string) => void;
  onAction: (tripId: string, action: string, anchorRect: DOMRect) => void;
  actionLoading: string | null;
  canComplete: boolean;
  canCancelPostpone: boolean;
}

export const TripCard = forwardRef<HTMLDivElement, TripCardProps>(function TripCard(
  {
    trip,
    onEdit,
    onAction,
    actionLoading,
    canComplete: canDoComplete,
    canCancelPostpone: canDoCancelPostpone,
  },
  ref,
) {
  const router = useRouter();
  const cardRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const captureRef = useCallback(
    (el: HTMLDivElement | null) => {
      (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
    },
    [ref],
  );

  const wrappedOnAction = useCallback(
    (tripId: string, action: string) => {
      if (action === 'view') {
        router.push(`/admin/trips/${tripId}`);
        return;
      }
      const rect = cardRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0);
      onAction(tripId, action, rect);
    },
    [onAction, router],
  );

  return (
    <Card ref={captureRef} hover className={`relative flex flex-col gap-5 h-full${menuOpen ? ' z-10' : ''}`}>
      <div
        className="cursor-pointer flex-1 flex flex-col gap-5"
        onClick={() => wrappedOnAction(trip.id, 'view')}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-[family-name:var(--font-heading)] font-bold text-[18px] text-[var(--color-brand-navy)] leading-tight truncate">
              {trip.route.destination}
            </h3>
            <div className="flex items-center gap-1.5 mt-1">
              <MapPin className="w-3.5 h-3.5 text-[var(--color-brand-muted)] shrink-0" />
              <p className="font-[family-name:var(--font-body)] font-normal text-xs text-[var(--color-brand-muted)] truncate">
                Desde {trip.route.origin}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <TripStatusBadge status={trip.status} postponed={!!trip.postponed_from} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--color-brand-muted)]">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            <span className="font-[family-name:var(--font-body)] font-medium">
              {formatDateTime(trip.departure_time)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Bus className="w-3.5 h-3.5 shrink-0" />
            <span className="font-[family-name:var(--font-body)]">
              {VEHICLE_LABELS[trip.vehicle.type] || trip.vehicle.type} &middot; {trip.vehicle.capacity} asientos
            </span>
          </div>
        </div>

        <div className="space-y-4">
          <TripOccupancy
            total={trip.occupancy.total}
            available={trip.occupancy.available}
            reserved={trip.occupancy.reserved}
            locked={trip.occupancy.locked}
            blocked={trip.occupancy.blocked}
            boarded={trip.occupancy.boarded}
          />
          <TripAgencies agencies={trip.agencies} />
        </div>
      </div>

      <TripActions
        trip={trip}
        onEdit={() => onEdit(trip.id)}
        onAction={wrappedOnAction}
        actionLoading={actionLoading === trip.id}
        canComplete={canDoComplete}
        canCancelPostpone={canDoCancelPostpone}
        onMenuToggle={setMenuOpen}
      />
    </Card>
  );
});

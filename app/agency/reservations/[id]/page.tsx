'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { format } from 'date-fns';
import { ArrowLeft, Calendar, MapPin, Users, User, CreditCard, QrCode } from 'lucide-react';
import { QRCode } from 'react-qr-code';
import { agencyApi } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

const STATUS_STYLES: Record<string, { label: string; variant: 'confirmed' | 'boarded' | 'cancelled' | 'warning' }> = {
  confirmed: { label: 'Confirmada', variant: 'confirmed' },
  boarded: { label: 'Abordado', variant: 'boarded' },
  cancelled: { label: 'Cancelada', variant: 'cancelled' },
};

type Passenger = {
  id: string;
  name: string;
  document: string;
  phone?: string | null;
  status: string;
  seat_id: string;
  seats?: { seat_code: string };
};

type ReservationDetail = {
  id: string;
  booker_name: string;
  booker_document: string;
  booker_phone?: string | null;
  status: string;
  qr_code: string;
  trip_id: string;
  created_at: string;
  trips: {
    id: string;
    departure_time: string;
    vehicle_type: string;
    routes: { origin: string; destination: string } | null;
  } | null;
  reservation_passengers?: Passenger[];
};

export default function ReservationDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [reservation, setReservation] = useState<ReservationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [showConfirm, setShowConfirm] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await agencyApi.getReservation(id);
      setReservation(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar reserva');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCancel = async () => {
    setCancelLoading('loading');
    setShowConfirm(false);
    try {
      await agencyApi.cancelAgencyReservation(id);
      setCancelLoading('success');
      await fetchData();
      setTimeout(() => setCancelLoading('idle'), 2500);
    } catch (err) {
      setCancelLoading('error');
      setTimeout(() => setCancelLoading('idle'), 2500);
    }
  };

  const trip = reservation?.trips;
  const passengers = reservation?.reservation_passengers ?? [];
  const statusInfo = STATUS_STYLES[reservation?.status ?? ''] ?? STATUS_STYLES.confirmed;

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="space-y-6">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </main>
    );
  }

  if (error || !reservation) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader
          title="Reserva no encontrada"
          breadcrumbs={[
            { label: 'Agencia', href: '/agency' },
            { label: 'Reservas', href: '/agency/reservations' },
          ]}
        />
        <p className="text-sm text-[var(--color-brand-muted)] mt-4">{error ?? 'La reserva no existe o fue eliminada.'}</p>
        <Link href="/agency/reservations" className="inline-flex items-center gap-2 mt-4 text-sm font-semibold text-[var(--color-brand-cyan)] no-underline hover:underline">
          <ArrowLeft className="w-4 h-4" />
          Volver a reservas
        </Link>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <PageHeader
        title={`Reserva #${reservation.id.slice(0, 8)}`}
        breadcrumbs={[
          { label: 'Agencia', href: '/agency' },
          { label: 'Reservas', href: '/agency/reservations' },
        ]}
        action={
          <div className="flex items-center gap-3">
            <Badge variant={statusInfo.variant} size="md">{statusInfo.label}</Badge>
            {reservation.status === 'confirmed' && (
              <Button
                variant="destructive"
                size="sm"
                loading={cancelLoading === 'loading'}
                feedback={cancelLoading === 'success' ? 'success' : cancelLoading === 'error' ? 'error' : null}
                onClick={() => setShowConfirm(true)}
              >
                Cancelar reserva
              </Button>
            )}
          </div>
        }
      />

      {cancelLoading === 'error' && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 font-[family-name:var(--font-body)] text-sm text-red-600">
          Error al cancelar la reserva. Intenta de nuevo.
        </div>
      )}

      <ConfirmModal
        open={showConfirm}
        title="¿Cancelar reserva?"
        message="Se liberarán todos los asientos de esta reserva. Esta acción no se puede deshacer."
        confirmLabel="Sí, cancelar"
        cancelLabel="Volver"
        onConfirm={handleCancel}
        onCancel={() => setShowConfirm(false)}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <SectionTitle>Viaje</SectionTitle>
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <MapPin className="w-4 h-4 text-[var(--color-brand-cyan)] shrink-0" />
                <span className="font-[family-name:var(--font-body)] font-medium text-[var(--color-brand-navy)]">
                  {trip?.routes?.origin ?? '—'} → {trip?.routes?.destination ?? '—'}
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Calendar className="w-4 h-4 text-[var(--color-brand-cyan)] shrink-0" />
                <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]">
                  {trip?.departure_time ? format(new Date(trip.departure_time), 'dd/MM/yyyy HH:mm') : '—'}
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <CreditCard className="w-4 h-4 text-[var(--color-brand-cyan)] shrink-0" />
                <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)] capitalize">
                  {trip?.vehicle_type ?? '—'}
                </span>
              </div>
            </div>
          </Card>

          <Card>
            <SectionTitle>Reservador</SectionTitle>
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <User className="w-4 h-4 text-[var(--color-brand-cyan)] shrink-0" />
                <span className="font-[family-name:var(--font-body)] font-medium text-[var(--color-brand-navy)]">
                  {reservation.booker_name}
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <CreditCard className="w-4 h-4 text-[var(--color-brand-cyan)] shrink-0" />
                <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]">
                  {reservation.booker_document}
                </span>
              </div>
              {reservation.booker_phone && (
                <div className="flex items-center gap-3 text-sm">
                  <User className="w-4 h-4 text-[var(--color-brand-cyan)] shrink-0" />
                  <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]">
                    {reservation.booker_phone}
                  </span>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <SectionTitle>Pasajeros ({passengers.length})</SectionTitle>
            <div className="mt-4 space-y-3">
              {passengers.map((p, idx) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[var(--color-brand-navy)] flex items-center justify-center">
                      <span className="font-[family-name:var(--font-body)] font-bold text-xs text-white">{idx + 1}</span>
                    </div>
                    <div>
                      <p className="font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-navy)]">{p.name}</p>
                      <p className="font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">{p.document}</p>
                    </div>
                  </div>
                  <span className="font-[family-name:var(--font-body)] font-bold text-[13px] text-[var(--color-brand-navy)] bg-white px-2.5 py-0.5 rounded-md border border-slate-200">
                    {p.seats?.seat_code ?? '—'}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <SectionTitle>Código QR</SectionTitle>
            <div className="mt-4 flex flex-col items-center gap-3">
              <div className="bg-white p-3 rounded-xl border border-slate-200">
                <QRCode value={reservation.qr_code} size={180} />
              </div>
              <p className="font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)] text-center">
                Escanea este código para realizar el abordaje
              </p>
            </div>
          </Card>

          <Card>
            <SectionTitle>Información</SectionTitle>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]">Creada</span>
                <span className="font-[family-name:var(--font-body)] font-medium text-[var(--color-brand-navy)]">
                  {format(new Date(reservation.created_at), 'dd/MM HH:mm')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]">Pasajeros</span>
                <span className="font-[family-name:var(--font-body)] font-medium text-[var(--color-brand-navy)]">{passengers.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]">Estado</span>
                <Badge variant={statusInfo.variant} size="sm">{statusInfo.label}</Badge>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}

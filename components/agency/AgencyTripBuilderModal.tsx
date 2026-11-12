'use client';

import { useEffect, useState } from 'react';
import { X, AlertCircle, RefreshCw } from 'lucide-react';
import { Modal, ModalHeader, ModalDivider, ModalBody } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { BuilderLayout } from '@/components/admin/trip-builder/BuilderLayout';
import { AdminTripCardSkeleton } from '@/components/admin/skeleton/AdminTripCardSkeleton';
import { agencyApi } from '@/lib/api';
import { fromUTCToLocal } from '@/lib/timezone';
import { seatPriceCentsToInput } from '@/lib/price';
import { ApiError } from '@/lib/errors/api-error';
import type { TripBuilderState } from '@/hooks/useTripBuilderReducer';

/**
 * AS-TRIP-003.1 — alta de viaje desde `/agency/trips` en MODAL, con la
 * misma experiencia que el builder del superadmin (`TripBuilderModal`):
 * mismos pasos, mismos componentes (`RouteStep`, `ScheduleStep`,
 * `VehicleStep`, `ReviewStep`), misma validación y mismo patrón de
 * interacción. Diferencias de agencia:
 *
 * - Rutas: solo el catálogo global activo de `GET /api/agency/routes`.
 * - Vehículos: los tipos soportados (bus/kia); la capacidad y la
 *   pertenencia del viaje a la agencia autenticada las valida el backend.
 * - Sin paso de Agencias ni `agency_ids`: la identidad de la agencia sale
 *   SIEMPRE de la sesión (`req.ctx`), nunca del cliente.
 * - Envío contra `POST /api/agency/trips`.
 *
 * AS-TRIP-004 — modo edición (`mode="edit"` + `tripId`): carga el viaje
 * con `GET /api/agency/trips/:tripId` (los renglones de la lista no
 * traen `route_id` ni `seat_price`), precarga el builder y envía contra
 * `PATCH /api/agency/trips/:tripId`. Mismas restricciones: sin selector
 * de agencias, sin estado, sin reservas (las decide el backend).
 *
 * El modal solo se cierra tras un éxito confirmado; si la petición falla
 * permanece abierto con el error visible para reintentar.
 */

type SubmitMode = 'create' | 'edit';

/** Traduce los errores del backend a mensajes accionables (sin éxito falso). */
function tripSubmitErrorMessage(error: unknown, mode: SubmitMode): string {
  const isEdit = mode === 'edit';
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return isEdit
        ? 'El viaje o la ruta seleccionada ya no existe. Actualiza la lista e inténtalo de nuevo.'
        : 'La ruta seleccionada ya no existe. Actualiza la lista e inténtalo de nuevo.';
    }
    if (error.status === 403) {
      return isEdit
        ? 'No puedes editar este viaje. Solo se permiten viajes exclusivos de tu agencia y aún sin reservas.'
        : 'No puedes crear viajes con estos datos. Verifica la ruta, la agencia y el vehículo.';
    }
    if (error.status === 409) {
      return (
        error.message ||
        'Ya existe un viaje para esta ruta en la fecha y hora seleccionadas.'
      );
    }
    if (error.message) return error.message;
  }
  return isEdit
    ? 'No se pudieron guardar los cambios. Intenta de nuevo.'
    : 'No se pudo crear el viaje. Intenta de nuevo.';
}

export function createTripErrorMessage(error: unknown): string {
  return tripSubmitErrorMessage(error, 'create');
}

export function updateTripErrorMessage(error: unknown): string {
  return tripSubmitErrorMessage(error, 'edit');
}

interface AgencyTripBuilderModalProps {
  open: boolean;
  onClose: () => void;
  /** Se invoca SOLO tras un éxito confirmado por el backend. */
  onSuccess: () => void;
  /**
   * AS-TRIP-004 — 'edit' carga `tripId` con `GET /api/agency/trips/:id`
   * y envía por PATCH. Por defecto 'create' (alta, sin cambios).
   */
  mode?: SubmitMode;
  /** Requerido en modo edición. */
  tripId?: string;
}

export function AgencyTripBuilderModal({
  open,
  onClose,
  onSuccess,
  mode = 'create',
  tripId,
}: AgencyTripBuilderModalProps) {
  const isEdit = mode === 'edit';

  // Datos precargados del viaje (solo edición). `null` = aún sin cargar.
  const [initialData, setInitialData] = useState<Partial<TripBuilderState> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!open) {
      // Al cerrar se limpia: la próxima apertura nunca arrastra los
      // valores de otro viaje (ni de una creación previa).
      setInitialData(null);
      setLoadError(false);
      return;
    }
    if (!isEdit || !tripId) return;

    let active = true;
    setLoadError(false);
    setInitialData(null);

    agencyApi
      .getTrip(tripId)
      .then((trip) => {
        if (!active) return;
        setInitialData({
          route_id: trip.route_id ?? '',
          departure_time: trip.departure_time
            ? fromUTCToLocal(trip.departure_time)
            : '',
          vehicle_type: trip.vehicle_type ?? 'bus',
          // Precio en centavos → texto en pesos. Vacío = preservar actual.
          seat_price_input: seatPriceCentsToInput(trip.seat_price),
        });
      })
      .catch(() => {
        if (active) setLoadError(true);
      });

    return () => {
      active = false;
    };
  }, [open, isEdit, tripId, reloadToken]);

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader>
        <div className="flex items-center gap-3">
          <div className="w-1 h-[18px] bg-[var(--color-brand-cyan)] rounded-sm" />
          <h2 className="font-[family-name:var(--font-heading)] font-bold text-base text-[var(--color-brand-navy)]">
            {isEdit ? 'Editar viaje' : 'Nuevo viaje'}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 p-2 -mr-2 rounded-lg text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)] hover:bg-slate-100 transition-colors"
          aria-label="Cerrar"
        >
          <X className="w-5 h-5" />
        </button>
      </ModalHeader>
      <ModalDivider />
      <ModalBody>
        {/* Montaje condicional: cada apertura empieza con el builder en
            su paso 0 (el Modal ya desmonta al cerrar, esto lo garantiza
            también durante la animación de salida). */}
        {open && !isEdit && (
          <BuilderLayout
            variant="agency"
            mode="create"
            onSuccess={onSuccess}
            mapSubmitError={createTripErrorMessage}
          />
        )}

        {/* AS-TRIP-004 — edición: skeleton mientras llega el viaje… */}
        {open && isEdit && !initialData && !loadError && (
          <div className="p-6">
            <AdminTripCardSkeleton />
          </div>
        )}

        {/* …error de carga con reintentar sin cerrar el modal… */}
        {open && isEdit && loadError && (
          <div className="flex flex-col items-start gap-4 p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2]">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-[#ef4444] shrink-0" strokeWidth={1.75} />
              <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
                No se pudo cargar el viaje a editar. Intenta de nuevo.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setReloadToken((token) => token + 1)}
            >
              <RefreshCw className="w-4 h-4" />
              Reintentar
            </Button>
          </div>
        )}

        {/* …y el builder ya precargado cuando el viaje llegó. */}
        {open && isEdit && initialData && tripId && (
          <BuilderLayout
            variant="agency"
            mode="edit"
            tripId={tripId}
            initialData={initialData}
            onSuccess={onSuccess}
            mapSubmitError={updateTripErrorMessage}
          />
        )}
      </ModalBody>
    </Modal>
  );
}

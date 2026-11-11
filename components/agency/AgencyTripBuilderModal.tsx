'use client';

import { X } from 'lucide-react';
import { Modal, ModalHeader, ModalDivider, ModalBody } from '@/components/ui/Modal';
import { BuilderLayout } from '@/components/admin/trip-builder/BuilderLayout';
import { ApiError } from '@/lib/errors/api-error';

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
 * El modal solo se cierra tras un éxito confirmado; si la petición falla
 * permanece abierto con el error visible para reintentar.
 */

/** Traduce los errores del backend a mensajes accionables (sin éxito falso). */
export function createTripErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return 'La ruta seleccionada ya no existe. Actualiza la lista e inténtalo de nuevo.';
    }
    if (error.status === 403) {
      return 'No puedes crear viajes con estos datos. Verifica la ruta, la agencia y el vehículo.';
    }
    if (error.status === 409) {
      return (
        error.message ||
        'Ya existe un viaje para esta ruta en la fecha y hora seleccionadas.'
      );
    }
    if (error.message) return error.message;
  }
  return 'No se pudo crear el viaje. Intenta de nuevo.';
}

interface AgencyTripBuilderModalProps {
  open: boolean;
  onClose: () => void;
  /** Se invoca SOLO tras una creación confirmada por el backend. */
  onSuccess: () => void;
}

export function AgencyTripBuilderModal({
  open,
  onClose,
  onSuccess,
}: AgencyTripBuilderModalProps) {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader>
        <div className="flex items-center gap-3">
          <div className="w-1 h-[18px] bg-[var(--color-brand-cyan)] rounded-sm" />
          <h2 className="font-[family-name:var(--font-heading)] font-bold text-base text-[var(--color-brand-navy)]">
            Nuevo viaje
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
        {open && (
          <BuilderLayout
            variant="agency"
            mode="create"
            onSuccess={onSuccess}
            mapSubmitError={createTripErrorMessage}
          />
        )}
      </ModalBody>
    </Modal>
  );
}

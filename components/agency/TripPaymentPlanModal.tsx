'use client';

import { useEffect, useId, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Wallet, AlertCircle, CalendarDays } from 'lucide-react';

import { Modal, ModalHeader, ModalDivider, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DatePicker } from '@/components/ui/DatePicker';
import { agencyApi } from '@/lib/api';
import {
  SEAT_PRICE_INVALID_MESSAGE,
  formatSeatPriceCents,
  parseSeatPricePesosInput,
  seatPriceCentsToInput,
} from '@/lib/price';
import { toBusinessDateString } from '@/lib/timezone';
import type { AgencyTrip } from '@/components/agency/AgencyTripCard';

interface TripPaymentPlanModalProps {
  open: boolean;
  /** Viaje seleccionado para configurar (null = nada que configurar). */
  trip: AgencyTrip | null;
  onClose: () => void;
  /** Solo llega tras un PATCH exitoso: cierra, avisa y refresca la lista. */
  onSuccess: () => void;
}

const REQUIRED_DEPOSIT_MESSAGE =
  'El depósito por puesto es obligatorio para habilitar el plan.';
const REQUIRED_DEADLINES_MESSAGE =
  'Ambos vencimientos son obligatorios (depósito y saldo).';
const DEPOSIT_LT_PRICE_MESSAGE =
  'El depósito debe ser menor que el precio por puesto.';
const SAVE_ERROR_MESSAGE =
  'No se pudo guardar el plan de pago. Intenta de nuevo.';

/** ISO de la BD → fecha de negocio `YYYY-MM-DD` para el DatePicker. */
function toDatePickerValue(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return toBusinessDateString(iso);
  } catch {
    return '';
  }
}

/**
 * MKT-010.1 (lado Tour) — `PATCH /api/agency/trips/:tripId/payment-plan`.
 *
 * Modal independiente del builder de viaje (allí solo se edita ruta,
 * salida, vehículo y precio). Desde aqui la agencia habilita el pago en
 * dos partes: depósito fijo por puesto + vencimientos de depósito y
 * saldo. El importe se escribe en PESOS COP enteros y se convierte a
 * centavos UNA sola vez, con las mismas utilidades del precio del viaje.
 *
 * Reglas de la pantalla:
 *  - deshabilitar siempre es válido (limpia importe y vencimientos);
 *  - al habilitar: depósito > 0, < precio por puesto y ambas fechas;
 *  - error del backend → mensaje en línea y el modal SIGUE ABIERTO
 *    (nunca se pierde lo escrito);
 *  - botón con estados normal / loading (spinner + disabled) / resultado.
 */
export function TripPaymentPlanModal({
  open,
  trip,
  onClose,
  onSuccess,
}: TripPaymentPlanModalProps) {
  const instanceId = useId();
  const titleId = `plan-title-${instanceId}`;
  const depositDateId = `plan-deposit-date-${instanceId}`;
  const balanceDateId = `plan-balance-date-${instanceId}`;

  const [enabled, setEnabled] = useState(false);
  const [depositInput, setDepositInput] = useState('');
  const [depositDeadline, setDepositDeadline] = useState('');
  const [balanceDeadline, setBalanceDeadline] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Precarga desde la lista + reset en cada apertura: nunca arrastra
  // los valores de otro viaje ni de una sesión previa.
  useEffect(() => {
    if (!open) return;
    setEnabled(Boolean(trip?.installment_allowed));
    setDepositInput(seatPriceCentsToInput(trip?.installment_amount_cents));
    setDepositDeadline(toDatePickerValue(trip?.deposit_deadline));
    setBalanceDeadline(toDatePickerValue(trip?.balance_deadline));
    setSaving(false);
    setError(null);
  }, [open, trip]);

  const parsedDeposit = parseSeatPricePesosInput(depositInput);

  const handleSubmit = async () => {
    if (saving || !trip) return;

    if (enabled) {
      if (parsedDeposit.invalid) {
        setError(SEAT_PRICE_INVALID_MESSAGE);
        return;
      }
      if (parsedDeposit.cents === null || parsedDeposit.cents <= 0) {
        setError(REQUIRED_DEPOSIT_MESSAGE);
        return;
      }
      if (!depositDeadline || !balanceDeadline) {
        setError(REQUIRED_DEADLINES_MESSAGE);
        return;
      }
      if (trip.seat_price != null && parsedDeposit.cents >= trip.seat_price) {
        setError(DEPOSIT_LT_PRICE_MESSAGE);
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      await agencyApi.updateTripPaymentPlan(
        trip.id,
        enabled
          ? {
              enabled: true,
              deposit_amount_cents: parsedDeposit.cents,
              deposit_deadline: depositDeadline,
              balance_deadline: balanceDeadline,
            }
          : { enabled: false },
      );
      toast.success(
        enabled
          ? 'Plan de pago habilitado correctamente'
          : 'Plan de pago deshabilitado correctamente',
      );
      onSuccess();
    } catch (err) {
      // El modal queda abierto con el mensaje: nada de lo escrito se
      // pierde y se puede corregir sin recargar la página.
      setError(
        err instanceof Error && err.message ? err.message : SAVE_ERROR_MESSAGE,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="md" titleId={titleId}>
      <ModalHeader>
        <div className="flex items-center gap-3">
          <div className="w-1 h-[18px] bg-[var(--color-brand-cyan)] rounded-sm" />
          <h2
            id={titleId}
            className="font-[family-name:var(--font-heading)] font-bold text-base text-[var(--color-brand-navy)]"
          >
            Plan de pago
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="shrink-0 p-2 -mr-2 rounded-lg text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)] hover:bg-slate-100 transition-colors disabled:opacity-40"
          aria-label="Cerrar"
        >
          <X className="w-5 h-5" />
        </button>
      </ModalHeader>
      <ModalDivider />

      {open && (
        <>
          <ModalBody>
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--color-brand-muted)]">
                <span className="font-[family-name:var(--font-body)] font-semibold text-[var(--color-brand-navy)]">
                  {trip?.route?.destination ?? 'Viaje'}
                </span>
                {trip?.departure_time && (
                  <span>{toBusinessDateString(trip.departure_time)}</span>
                )}
                {trip?.seat_price != null && (
                  <span>
                    Puesto: {formatSeatPriceCents(trip.seat_price)}
                  </span>
                )}
              </div>

              {/* Encendido del plan: habilitar siempre es reversible. */}
              <label className="flex items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 border border-[rgba(0,0,0,0.06)] cursor-pointer select-none">
                <span className="min-w-0">
                  <span className="block font-[family-name:var(--font-heading)] font-semibold text-sm text-[var(--color-brand-navy)]">
                    Pago en dos partes
                  </span>
                  <span className="block font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)] mt-0.5">
                    Cobra primero un depósito fijo por puesto y después el
                    saldo restante.
                  </span>
                </span>
                <span className="relative inline-flex shrink-0">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => {
                      setEnabled(e.target.checked);
                      setError(null);
                    }}
                    disabled={saving}
                    className="sr-only peer"
                  />
                  <span className="block w-10 h-6 rounded-full bg-slate-200 peer-checked:bg-[var(--color-brand-cyan)] transition-colors duration-200" />
                  <span className="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 peer-checked:translate-x-4" />
                </span>
              </label>

              {enabled && (
                <div className="space-y-4">
                  <Input
                    label="Depósito por puesto (COP)"
                    value={depositInput}
                    onChange={(e) => {
                      setDepositInput(e.target.value);
                      setError(null);
                    }}
                    placeholder="Ej: 50000"
                    inputMode="numeric"
                    autoComplete="off"
                    disabled={saving}
                    leftIcon={<Wallet className="w-4 h-4" strokeWidth={1.75} />}
                    helperText={
                      trip?.seat_price != null
                        ? `Debe ser menor que el precio por puesto (${formatSeatPriceCents(trip.seat_price)}).`
                        : 'Importe en pesos COP enteros.'
                    }
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor={depositDateId}
                        className="font-[family-name:var(--font-body)] font-medium text-xs text-[var(--color-brand-muted)] uppercase tracking-wider"
                      >
                        Vencimiento del depósito
                      </label>
                      <DatePicker
                        value={depositDeadline}
                        onChange={(value) => {
                          setDepositDeadline(value);
                          setError(null);
                        }}
                        placeholder="Elige una fecha"
                        disabled={saving}
                        className="w-full"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor={balanceDateId}
                        className="font-[family-name:var(--font-body)] font-medium text-xs text-[var(--color-brand-muted)] uppercase tracking-wider"
                      >
                        Vencimiento del saldo
                      </label>
                      <DatePicker
                        value={balanceDeadline}
                        onChange={(value) => {
                          setBalanceDeadline(value);
                          setError(null);
                        }}
                        placeholder="Elige una fecha"
                        disabled={saving}
                        className="w-full"
                      />
                    </div>
                  </div>

                  <p className="flex items-start gap-2 font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
                    <CalendarDays
                      className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--color-brand-cyan)]"
                      strokeWidth={1.75}
                    />
                    Los vencimientos son informativos: no cancelan la
                    reserva ni liberan los asientos.
                  </p>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-3 p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2]"
                >
                  <AlertCircle
                    className="w-5 h-5 text-[#ef4444] shrink-0 mt-0.5"
                    strokeWidth={1.75}
                  />
                  <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
                    {error}
                  </p>
                </div>
              )}
            </div>
          </ModalBody>

          <ModalFooter className="justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              loading={saving}
            >
              {enabled ? 'Guardar plan' : 'Deshabilitar plan'}
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}

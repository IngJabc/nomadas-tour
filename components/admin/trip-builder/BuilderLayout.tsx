'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, AlertCircle, RefreshCw } from 'lucide-react';
import { useTripBuilderReducer, tripBuilderStepCount, type TripBuilderState } from '@/hooks/useTripBuilderReducer';
import { adminApi, agencyApi } from '@/lib/api';
import {
  DEPARTURE_MUST_BE_FUTURE_MESSAGE,
  isDepartureTimeInFuture,
} from '@/lib/timezone';
import {
  SEAT_PRICE_INVALID_MESSAGE,
  SEAT_PRICE_REQUIRED_MESSAGE,
  parseSeatPricePesosInput,
} from '@/lib/price';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AdminTripCardSkeleton } from '@/components/admin/skeleton/AdminTripCardSkeleton';
import { StepIndicator } from '@/components/admin/trip-builder/StepIndicator';
import { RouteStep } from '@/components/admin/trip-builder/RouteStep';
import { ScheduleStep } from '@/components/admin/trip-builder/ScheduleStep';
import { VehicleStep } from '@/components/admin/trip-builder/VehicleStep';
import { AgenciesStep } from '@/components/admin/trip-builder/AgenciesStep';
import { ReviewStep } from '@/components/admin/trip-builder/ReviewStep';
import type { Route } from '@/types';

interface BuilderLayoutProps {
  mode: 'create' | 'edit';
  tripId?: string;
  initialData?: Partial<TripBuilderState>;
  onSuccess?: () => void;
  /**
   * AS-TRIP-003.1 — 'agency' = alta desde el panel de agencia:
   * catálogo por `GET /api/agency/routes`, sin paso de Agencias (la
   * asignación la hace el backend desde la sesión) y envío por
   * `POST /api/agency/trips`. Por defecto 'admin': el builder del
   * superadmin no cambia.
   */
  variant?: 'admin' | 'agency';
  /**
   * Traduce un error de envío a un mensaje accionable. Opcional: sin él
   * se muestra `error.message` (comportamiento histórico del admin).
   */
  mapSubmitError?: (error: unknown) => string;
}

const STEP_LABELS_ADMIN = ['Ruta', 'Programación', 'Vehículo', 'Agencias', 'Revisión'];
const STEP_LABELS_AGENCY = ['Ruta', 'Programación', 'Vehículo', 'Revisión'];

/**
 * Estado vacío del catálogo para el alta de agencia: las rutas son
 * globales, así que la siguiente acción es pedírselas al superadmin.
 */
const AGENCY_EMPTY_ROUTES_MESSAGE =
  'No hay rutas disponibles para crear un viaje. Las rutas son globales: solicita al superadmin la creación de la ruta que necesitas y aquí aparecerá para que puedas programar el viaje.';

const stepVariants = {
  enter: (dir: number) => ({ x: dir * 40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir * -40, opacity: 0 }),
};

const errorVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export function BuilderLayout({
  mode,
  tripId,
  initialData,
  onSuccess,
  variant = 'admin',
  mapSubmitError,
}: BuilderLayoutProps) {
  const includeAgencies = variant !== 'agency';
  const totalSteps = tripBuilderStepCount(includeAgencies);
  const lastStep = totalSteps - 1;

  const { state, dispatch, canProceed } = useTripBuilderReducer(initialData, {
    includeAgencies,
  });

  const [routes, setRoutes] = useState<
    Array<Pick<Route, 'id' | 'origin' | 'destination' | 'status'>>
  >([]);
  const [agencies, setAgencies] = useState<{ id: string; name: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitFeedback, setSubmitFeedback] = useState<'success' | 'error' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [navError, setNavError] = useState<string | null>(null);

  const prevStep = useRef(state.currentStep);
  const direction = state.currentStep > prevStep.current ? 1 : -1;
  prevStep.current = state.currentStep;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);

    const load = async () => {
      try {
        if (includeAgencies) {
          const [routeData, agencyData] = await Promise.all([
            adminApi.listRoutes(),
            adminApi.listAgencies(),
          ]);
          if (!active) return;
          setRoutes(routeData);
          setAgencies(agencyData);
        } else {
          // Catálogo global de rutas activas del lado de la agencia.
          // No se piden agencias: el alta no tiene selector de agencias.
          const routeData = await agencyApi.listRoutes();
          if (!active) return;
          setRoutes(routeData);
          setAgencies([]);
        }
      } catch {
        if (!active) return;
        setRoutes([]);
        setAgencies([]);
        setLoadError(true);
      }
      if (active) setLoading(false);
    };
    load();

    return () => {
      active = false;
    };
  }, [includeAgencies, reloadToken]);

  const handleNext = useCallback(() => {
    if (!canProceed()) {
      setNavError('Completa todos los campos requeridos antes de continuar.');
      return;
    }

    if (state.currentStep === 1 && !isDepartureTimeInFuture(state.departure_time)) {
      setNavError(DEPARTURE_MUST_BE_FUTURE_MESSAGE);
      return;
    }

    if (state.currentStep === 2) {
      const parsedPrice = parseSeatPricePesosInput(state.seat_price_input);
      if (parsedPrice.invalid) {
        setNavError(SEAT_PRICE_INVALID_MESSAGE);
        return;
      }
      if (mode === 'create' && parsedPrice.cents === null) {
        setNavError(SEAT_PRICE_REQUIRED_MESSAGE);
        return;
      }
    }

    setNavError(null);
    setSubmitError(null);
    // Nunca avanzar más allá del último paso de la variante actual
    // (4 pasos en agencia: Ruta → Programación → Vehículo → Revisión).
    if (state.currentStep < lastStep) {
      dispatch({ type: 'NEXT_STEP' });
    }
  }, [canProceed, dispatch, mode, state.currentStep, state.departure_time, state.seat_price_input, lastStep]);

  const handlePrevious = useCallback(() => {
    setNavError(null);
    setSubmitError(null);
    dispatch({ type: 'PREVIOUS_STEP' });
  }, [dispatch]);

  const handleSubmit = useCallback(async () => {
    const parsedPrice = parseSeatPricePesosInput(state.seat_price_input);
    if (parsedPrice.invalid) {
      setSubmitError(SEAT_PRICE_INVALID_MESSAGE);
      return;
    }
    if (mode === 'create' && parsedPrice.cents === null) {
      setSubmitError(SEAT_PRICE_REQUIRED_MESSAGE);
      return;
    }

    setSubmitLoading(true);
    setSubmitError(null);
    setSubmitFeedback(null);

    const pricePatch = parsedPrice.cents !== null ? { seat_price: parsedPrice.cents } : {};

    try {
      if (!includeAgencies) {
        // AS-TRIP-003.1 — alta desde la agencia: payload SIN agencia ni
        // agency_ids (el backend los deriva de la sesión y el schema
        // strict rechazaría campos extra). Endpoint propio:
        // POST /api/agency/trips.
        await agencyApi.createTrip({
          route_id: state.route_id,
          departure_time: state.departure_time,
          vehicle_type: state.vehicle_type as 'bus' | 'kia',
          ...pricePatch,
        });
      } else {
        const payload = {
          route_id: state.route_id,
          departure_time: state.departure_time,
          vehicle_type: state.vehicle_type as 'bus' | 'kia',
          agency_ids: state.agency_ids,
          // Centavos COP. Omitir = create sin precio / update preserva el actual.
          ...pricePatch,
        };

        if (mode === 'edit' && tripId) {
          await adminApi.updateTrip(tripId, payload);
        } else {
          await adminApi.createTrip(payload);
        }
      }
      setSubmitFeedback('success');
      setTimeout(() => {
        if (onSuccess) onSuccess();
      }, 600);
    } catch (err) {
      setSubmitError(
        mapSubmitError
          ? mapSubmitError(err)
          : err instanceof Error
            ? err.message
            : 'Error al guardar el viaje',
      );
    } finally {
      setSubmitLoading(false);
    }
  }, [state, mode, tripId, onSuccess, includeAgencies, mapSubmitError]);

  if (loading) {
    return (
      <div className="p-6">
        <AdminTripCardSkeleton />
      </div>
    );
  }

  // Fallo cargando el catálogo desde la agencia: el modal ofrece reintentar
  // sin cerrarse. El builder del superadmin conserva su estado vacío
  // histórico (sin cambio de comportamiento).
  if (loadError && !includeAgencies) {
    return (
      <div className="flex flex-col items-start gap-4 p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2]">
        <div className="flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-[#ef4444] shrink-0" strokeWidth={1.75} />
          <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
            No se pudieron cargar las rutas disponibles. Intenta de nuevo.
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
    );
  }

  const isValid = canProceed();
  const activeError = navError ?? submitError;

  return (
    <div className="flex flex-col">
      <div className="mb-6">
        <StepIndicator currentStep={state.currentStep} variant={variant} />
      </div>

      <div className="min-h-11 overflow-hidden">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={`label-${state.currentStep}`}
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            className="flex items-center gap-3 mb-5"
          >
            <div className="w-1 h-[18px] bg-[var(--color-brand-cyan)] rounded-sm shrink-0" />
            <h2 className="font-[family-name:var(--font-heading)] font-bold text-[18px] text-[var(--color-brand-navy)]">
              {(includeAgencies ? STEP_LABELS_ADMIN : STEP_LABELS_AGENCY)[state.currentStep]}
            </h2>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="h-[min(380px,calc(100dvh-332px))] shrink-0">
        <Card className="h-full min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain !shadow-none border-[rgba(0,0,0,0.06)]">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={state.currentStep}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="min-h-full w-full flex"
            >
              <div className="m-auto w-full max-w-lg py-2">
                {state.currentStep === 0 && (
                  <RouteStep
                    routes={routes}
                    selectedRouteId={state.route_id}
                    onSelect={(id) => dispatch({ type: 'SET_ROUTE', payload: id })}
                    emptyMessage={
                      includeAgencies ? undefined : AGENCY_EMPTY_ROUTES_MESSAGE
                    }
                  />
                )}
                {state.currentStep === 1 && (
                  <ScheduleStep
                    departureTime={state.departure_time}
                    onChange={(v) => dispatch({ type: 'SET_DEPARTURE_TIME', payload: v })}
                  />
                )}
                {state.currentStep === 2 && (
                  <VehicleStep
                    selectedType={state.vehicle_type as 'bus' | 'kia' | ''}
                    onSelect={(v) => dispatch({ type: 'SET_VEHICLE', payload: v })}
                    seatPriceInput={state.seat_price_input}
                    onSeatPriceInputChange={(v) =>
                      dispatch({ type: 'SET_SEAT_PRICE_INPUT', payload: v })
                    }
                  />
                )}
                {includeAgencies && state.currentStep === 3 && (
                  <AgenciesStep
                    agencies={agencies}
                    selectedIds={state.agency_ids}
                    onChange={(ids) => dispatch({ type: 'SET_AGENCIES', payload: ids })}
                  />
                )}
                {state.currentStep === lastStep && (
                  <ReviewStep
                    state={state}
                    routes={routes}
                    agencies={includeAgencies ? agencies : undefined}
                    mode={mode}
                  />
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </Card>
      </div>

      <div
        className="validation-slot h-[52px] shrink-0 flex items-center"
        aria-live="polite"
      >
        <AnimatePresence mode="wait">
          {activeError && (
            <motion.div
              key={navError ? 'nav-error' : 'submit-error'}
              variants={errorVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="w-full flex items-center gap-2 p-3 rounded-xl bg-[#fef2f2] border border-[#fee2e2]"
            >
              <AlertCircle className="w-4 h-4 text-[#ef4444] shrink-0" />
              <p className="font-[family-name:var(--font-body)] text-xs text-[#ef4444]">{activeError}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-[rgba(0,0,0,0.06)] shrink-0">
        <Button
          variant="secondary"
          onClick={handlePrevious}
          disabled={state.currentStep === 0}
        >
          <ArrowLeft className="w-4 h-4" />
          Anterior
        </Button>

        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={state.currentStep < lastStep ? 'next' : 'submit'}
            custom={direction}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
          >
            {state.currentStep < lastStep ? (
              <Button onClick={handleNext}>
                Siguiente
                <ArrowRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                loading={submitLoading}
                feedback={submitFeedback}
                disabled={!isValid}
              >
                {submitLoading
                  ? 'Guardando...'
                  : mode === 'edit'
                    ? 'Guardar cambios'
                    : 'Crear viaje'}
              </Button>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

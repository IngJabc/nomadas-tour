'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, AlertCircle } from 'lucide-react';
import { useTripBuilderReducer, type TripBuilderState } from '@/hooks/useTripBuilderReducer';
import { adminApi } from '@/lib/api';
import {
  DEPARTURE_MUST_BE_FUTURE_MESSAGE,
  isDepartureTimeInFuture,
} from '@/lib/timezone';
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
}

const STEP_LABELS = ['Ruta', 'Programación', 'Vehículo', 'Agencias', 'Revisión'];

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

export function BuilderLayout({ mode, tripId, initialData, onSuccess }: BuilderLayoutProps) {
  const { state, dispatch, canProceed } = useTripBuilderReducer(initialData);

  const [routes, setRoutes] = useState<Route[]>([]);
  const [agencies, setAgencies] = useState<{ id: string; name: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitFeedback, setSubmitFeedback] = useState<'success' | 'error' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [navError, setNavError] = useState<string | null>(null);

  const prevStep = useRef(state.currentStep);
  const direction = state.currentStep > prevStep.current ? 1 : -1;
  prevStep.current = state.currentStep;

  useEffect(() => {
    const load = async () => {
      try {
        const [routeData, agencyData] = await Promise.all([
          adminApi.listRoutes(),
          adminApi.listAgencies(),
        ]);
        setRoutes(routeData);
        setAgencies(agencyData);
      } catch {
        setRoutes([]);
        setAgencies([]);
      }
      setLoading(false);
    };
    load();
  }, []);

  const handleNext = useCallback(() => {
    if (!canProceed()) {
      setNavError('Completa todos los campos requeridos antes de continuar.');
      return;
    }

    if (state.currentStep === 1 && !isDepartureTimeInFuture(state.departure_time)) {
      setNavError(DEPARTURE_MUST_BE_FUTURE_MESSAGE);
      return;
    }

    setNavError(null);
    setSubmitError(null);
    dispatch({ type: 'NEXT_STEP' });
  }, [canProceed, dispatch, state.currentStep, state.departure_time]);

  const handlePrevious = useCallback(() => {
    setNavError(null);
    setSubmitError(null);
    dispatch({ type: 'PREVIOUS_STEP' });
  }, [dispatch]);

  const handleSubmit = useCallback(async () => {
    setSubmitLoading(true);
    setSubmitError(null);
    setSubmitFeedback(null);

    const payload = {
      route_id: state.route_id,
      departure_time: state.departure_time,
      vehicle_type: state.vehicle_type as 'bus' | 'kia',
      agency_ids: state.agency_ids,
    };

    try {
      if (mode === 'edit' && tripId) {
        await adminApi.updateTrip(tripId, payload);
      } else {
        await adminApi.createTrip(payload);
      }
      setSubmitFeedback('success');
      setTimeout(() => {
        if (onSuccess) onSuccess();
      }, 600);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Error al guardar el viaje');
    } finally {
      setSubmitLoading(false);
    }
  }, [state, mode, tripId, onSuccess]);

  if (loading) {
    return (
      <div className="p-6">
        <AdminTripCardSkeleton />
      </div>
    );
  }

  const isValid = canProceed();
  const activeError = navError ?? submitError;

  return (
    <div className="flex flex-col">
      <div className="mb-6">
        <StepIndicator currentStep={state.currentStep} />
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
              {STEP_LABELS[state.currentStep]}
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
                  />
                )}
                {state.currentStep === 3 && (
                  <AgenciesStep
                    agencies={agencies}
                    selectedIds={state.agency_ids}
                    onChange={(ids) => dispatch({ type: 'SET_AGENCIES', payload: ids })}
                  />
                )}
                {state.currentStep === 4 && (
                  <ReviewStep state={state} routes={routes} agencies={agencies} />
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
            key={state.currentStep < 4 ? 'next' : 'submit'}
            custom={direction}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
          >
            {state.currentStep < 4 ? (
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

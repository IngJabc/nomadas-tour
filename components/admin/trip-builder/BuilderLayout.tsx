'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, AlertCircle } from 'lucide-react';
import { useTripBuilderReducer, type TripBuilderState } from '@/hooks/useTripBuilderReducer';
import { adminApi } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { CardSkeleton } from '@/components/ui/Skeleton';
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
  initial: { opacity: 0, y: -8, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -8, scale: 0.96 },
};

export function BuilderLayout({ mode, tripId, initialData, onSuccess }: BuilderLayoutProps) {
  const { state, dispatch, canProceed } = useTripBuilderReducer(initialData);

  const [routes, setRoutes] = useState<Route[]>([]);
  const [agencies, setAgencies] = useState<{ id: string; name: string }[]>([]);
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
    setNavError(null);
    dispatch({ type: 'NEXT_STEP' });
  }, [canProceed, dispatch]);

  const handlePrevious = useCallback(() => {
    setNavError(null);
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
      setSubmitFeedback('error');
    } finally {
      setSubmitLoading(false);
    }
  }, [state, mode, tripId, onSuccess]);

  if (loading) {
    return (
      <div className="p-6">
        <CardSkeleton />
      </div>
    );
  }

  const isValid = canProceed();

  return (
    <div className="flex flex-col overflow-x-hidden">
      <div className="mb-6">
        <StepIndicator currentStep={state.currentStep} />
      </div>

      <div className="min-h-11">
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

      <div className="h-[380px] overflow-hidden flex flex-col">
        <Card className="flex-1 relative flex items-center justify-center">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={state.currentStep}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="w-full flex flex-col items-center justify-center"
            >
              <div className="mx-auto w-full max-w-lg">
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

          <div className="absolute bottom-0 left-0 right-0 px-6 pb-5 space-y-2">
            <AnimatePresence>
              {navError && (
                <motion.div
                  key="nav-error"
                  variants={errorVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="flex items-center gap-2 p-3 rounded-xl bg-[#fef2f2] border border-[#fee2e2]"
                >
                  <AlertCircle className="w-4 h-4 text-[#ef4444] shrink-0" />
                  <p className="font-[family-name:var(--font-body)] text-xs text-[#ef4444]">{navError}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {submitError && (
                <motion.div
                  key="submit-error"
                  variants={errorVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="flex items-center gap-2 p-3 rounded-xl bg-[#fef2f2] border border-[#fee2e2]"
                >
                  <AlertCircle className="w-4 h-4 text-[#ef4444] shrink-0" />
                  <p className="font-[family-name:var(--font-body)] text-xs text-[#ef4444]">{submitError}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Card>
      </div>

      <motion.div
        layout
        transition={{ duration: 0.25, ease: 'easeInOut' }}
        className="flex items-center justify-between pt-4 border-t border-[rgba(0,0,0,0.06)] shrink-0"
      >
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
      </motion.div>
    </div>
  );
}

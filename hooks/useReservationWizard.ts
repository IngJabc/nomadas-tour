'use client';

import { useRouter } from 'next/navigation';
import { useState, useCallback, useMemo } from 'react';
import { ReservationOrigin } from '@/types';

export type ReservationStep = 'select_trip' | 'select_seats' | 'passenger_form' | 'summary' | 'success';

interface UseReservationWizardOptions {
  isDeepLink: boolean;
  origin: ReservationOrigin;
}

interface UseReservationWizardReturn {
  step: ReservationStep;
  isDeepLinkFlow: boolean;
  origin: ReservationOrigin;
  currentStepIdx: number;
  stepDefs: { key: ReservationStep; label: string }[];
  goToSeats: () => void;
  goToPassengerForm: () => void;
  goToSummary: () => void;
  goToSuccess: () => void;
  goToTrips: () => void;
  goToSeatSelection: () => void;
  goToPassengerEntry: () => void;
  goBackFromSeats: () => void;
  resetWizard: () => void;
}

const STEP_DEFS: { key: ReservationStep; label: string }[] = [
  { key: 'select_trip', label: 'Viaje' },
  { key: 'select_seats', label: 'Asientos' },
  { key: 'passenger_form', label: 'Pasajeros' },
  { key: 'summary', label: 'Resumen' },
];

const STEP_KEYS = STEP_DEFS.map((s) => s.key);

export function useReservationWizard({ isDeepLink, origin }: UseReservationWizardOptions): UseReservationWizardReturn {
  const router = useRouter();
  const [step, setStep] = useState<ReservationStep>(isDeepLink ? 'select_seats' : 'select_trip');
  const [isDeepLinkFlow] = useState(isDeepLink);

  const currentStepIdx = STEP_KEYS.indexOf(step);

  const goToSeats = useCallback(() => setStep('select_seats'), []);
  const goToPassengerForm = useCallback(() => setStep('passenger_form'), []);
  const goToSummary = useCallback(() => setStep('summary'), []);
  const goToSuccess = useCallback(() => setStep('success'), []);
  const goToTrips = useCallback(() => setStep('select_trip'), []);
  const goToSeatSelection = useCallback(() => setStep('select_seats'), []);
  const goToPassengerEntry = useCallback(() => setStep('passenger_form'), []);

  const goBackFromSeats = useCallback(() => {
    if (origin === 'agency_trips') {
      router.push('/agency/trips');
    } else {
      setStep('select_trip');
    }
  }, [origin, router]);

  const resetWizard = useCallback(() => setStep('select_trip'), []);

  const stepDefs = useMemo(() => STEP_DEFS, []);

  return {
    step,
    isDeepLinkFlow,
    origin,
    currentStepIdx,
    stepDefs,
    goToSeats,
    goToPassengerForm,
    goToSummary,
    goToSuccess,
    goToTrips,
    goToSeatSelection,
    goToPassengerEntry,
    goBackFromSeats,
    resetWizard,
  };
}

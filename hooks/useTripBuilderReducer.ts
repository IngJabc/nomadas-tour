'use client';

import { useReducer, useCallback } from 'react';

export interface TripBuilderState {
  route_id: string;
  departure_time: string;
  vehicle_type: 'bus' | 'kia' | '';
  agency_ids: string[];
  /** Precio por puesto en pesos COP enteros (texto del input). */
  seat_price_input: string;
  currentStep: number;
}

export type TripBuilderAction =
  | { type: 'SET_ROUTE'; payload: string }
  | { type: 'SET_DEPARTURE_TIME'; payload: string }
  | { type: 'SET_VEHICLE'; payload: 'bus' | 'kia' }
  | { type: 'SET_AGENCIES'; payload: string[] }
  | { type: 'SET_SEAT_PRICE_INPUT'; payload: string }
  | { type: 'NEXT_STEP' }
  | { type: 'PREVIOUS_STEP' }
  | { type: 'SET_STEP'; payload: number }
  | { type: 'LOAD_FROM_TRIP'; payload: Partial<TripBuilderState> }
  | { type: 'RESET' };

const STEPS = ['route', 'schedule', 'vehicle', 'agencies', 'review'];

/** Pasos del builder SIN el paso de Agencias (alta desde la agencia). */
const STEPS_NO_AGENCIES = ['route', 'schedule', 'vehicle', 'review'];

export interface TripBuilderOptions {
  /**
   * false = builder sin paso de Agencias: es el alta desde el panel de
   * agencia, donde la asignación del viaje (exactamente una fila en
   * `trip_agencies`) la hace el backend desde la sesión. No hay selector
   * de agencias ni validación de agencias que cumplir.
   * Por defecto `true` (comportamiento del superadmin, sin cambios).
   */
  includeAgencies?: boolean;
}

export function getStepIndex(step: string): number {
  const idx = STEPS.indexOf(step);
  return idx >= 0 ? idx : 0;
}

export function getStepLabel(stepIndex: number): string {
  return STEPS[stepIndex] || '';
}

/** Cantidad de pasos del builder según la variante (admin = 5, agencia = 4). */
export function tripBuilderStepCount(includeAgencies: boolean = true): number {
  return (includeAgencies ? STEPS : STEPS_NO_AGENCIES).length;
}

export const TOTAL_STEPS = STEPS.length;

const initialState: TripBuilderState = {
  route_id: '',
  departure_time: '',
  vehicle_type: '',
  agency_ids: [],
  seat_price_input: '',
  currentStep: 0,
};

function tripBuilderReducer(
  state: TripBuilderState,
  action: TripBuilderAction,
): TripBuilderState {
  switch (action.type) {
    case 'SET_ROUTE':
      return { ...state, route_id: action.payload };
    case 'SET_DEPARTURE_TIME':
      return { ...state, departure_time: action.payload };
    case 'SET_VEHICLE':
      return { ...state, vehicle_type: action.payload };
    case 'SET_AGENCIES':
      return { ...state, agency_ids: action.payload };
    case 'SET_SEAT_PRICE_INPUT':
      return { ...state, seat_price_input: action.payload };
    case 'NEXT_STEP':
      return { ...state, currentStep: Math.min(state.currentStep + 1, TOTAL_STEPS - 1) };
    case 'PREVIOUS_STEP':
      return { ...state, currentStep: Math.max(state.currentStep - 1, 0) };
    case 'SET_STEP':
      return { ...state, currentStep: Math.max(0, Math.min(action.payload, TOTAL_STEPS - 1)) };
    case 'LOAD_FROM_TRIP':
      return { ...state, ...action.payload };
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}

export function useTripBuilderReducer(
  initial?: Partial<TripBuilderState>,
  options: TripBuilderOptions = {},
) {
  const includeAgencies = options.includeAgencies !== false;

  const [state, dispatch] = useReducer(tripBuilderReducer, {
    ...initialState,
    ...initial,
  });

  const canProceed = useCallback((): boolean => {
    switch (state.currentStep) {
      case 0:
        return state.route_id !== '';
      case 1:
        return state.departure_time !== '';
      case 2:
        return state.vehicle_type !== '';
      case 3:
        // Variante agencia: el paso 3 ya es "Revisión" (no hay Agencias),
        // así que la única validación restante es haber llegado a él.
        return includeAgencies ? state.agency_ids.length > 0 : true;
      case 4:
        return true;
      default:
        return false;
    }
  }, [state, includeAgencies]);

  const isStepValid = useCallback((step: number): boolean => {
    switch (step) {
      case 0:
        return state.route_id !== '';
      case 1:
        return state.departure_time !== '';
      case 2:
        return state.vehicle_type !== '';
      case 3:
        return includeAgencies ? state.agency_ids.length > 0 : true;
      case 4:
        return true;
      default:
        return false;
    }
  }, [state, includeAgencies]);

  return { state, dispatch, canProceed, isStepValid };
}

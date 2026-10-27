import { useCallback, useEffect, useRef, useState } from 'react';
import type { CleanupFn } from '@/lib/realtime/subscriptions';

/**
 * RT-06 — refresco en vivo del módulo de pagos de agencia.
 *
 * Un evento Realtime nunca interpreta payload: solo agenda una re-consulta
 * de la API (la autoridad del estado derivado). Las ráfagas colapsan en una
 * sola consulta (debounce) y entre refrescos hay un mínimo de separación
 * para no duplicar consultas cuando la acción local y su propio evento
 * Realtime llegan casi juntos.
 */
export const REALTIME_REFRESH_DEBOUNCE_MS = 500;
export const REALTIME_REFRESH_MIN_GAP_MS = 700;

/**
 * Crea un canal Realtime y devuelve su cleanup. El hook invoca:
 * - `onChange` ante cada evento → re-consulta agendada (debounce).
 * - `onStatus(false)` si el canal pierde la conexión → la vista marca
 *   datos potencialmente desactualizados y ofrece actualización manual.
 */
export type RealtimeSubscribeFn = (
  onChange: () => void,
  onStatus: (connected: boolean) => void,
) => CleanupFn;

interface UseRealtimeRefreshOptions {
  /** Una entrada por canal; debe ser estable (useCallback/useMemo). */
  subscriptions: RealtimeSubscribeFn[];
  /** Reconsulta inmediata de la vista actual (acciones y "Actualizar"). */
  refresh: () => void;
  /** Crea los canales solo cuando la vista está lista (identidad/params). */
  enabled?: boolean;
}

interface UseRealtimeRefreshResult {
  /** true = algún canal reportó pérdida de conexión Realtime. */
  degraded: boolean;
  /** Refresco inmediato: cancela el debounce pendiente y re-consulta ya. */
  refreshNow: () => void;
}

export function useRealtimeRefresh({
  subscriptions,
  refresh,
  enabled = true,
}: UseRealtimeRefreshOptions): UseRealtimeRefreshResult {
  const refreshRef = useRef(refresh);
  const [degraded, setDegraded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRunRef = useRef(0);
  const statusRef = useRef<boolean[]>([]);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const refreshNow = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    lastRunRef.current = Date.now();
    refreshRef.current();
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    // Si acaba de correr un refresco (acción local o "Actualizar"), difiere
    // para respetar el mínimo y plegar el evento redundante.
    const elapsed = Date.now() - lastRunRef.current;
    const wait = Math.max(
      REALTIME_REFRESH_DEBOUNCE_MS,
      REALTIME_REFRESH_MIN_GAP_MS - elapsed,
    );
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastRunRef.current = Date.now();
      refreshRef.current();
    }, wait);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    // Cada canal tiene su propio estado: basta con que UNO falle para que
    // la vista deje de aparentar datos actualizados.
    statusRef.current = subscriptions.map(() => true);
    setDegraded(false);

    const cleanups = subscriptions.map((subscribe, index) =>
      subscribe(
        () => {
          if (active) scheduleRefresh();
        },
        (connected) => {
          if (!active) return;
          statusRef.current[index] = connected;
          setDegraded(statusRef.current.some((ok) => !ok));
        },
      ),
    );

    return () => {
      active = false;
      for (const cleanup of cleanups) cleanup();
      // Nunca dejar un refresco programado vivo fuera de pantalla.
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, subscriptions, scheduleRefresh]);

  return { degraded, refreshNow };
}

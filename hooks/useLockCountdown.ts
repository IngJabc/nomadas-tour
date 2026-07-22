'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Seat } from '@/types';

interface UseLockCountdownOptions {
  selectedSeats: Seat[];
  ttlSeconds?: number;
  onExpired?: () => void;
}

interface UseLockCountdownReturn {
  remainingSeconds: number | null;
  formattedTime: string | null;
  stop: () => void;
}

export function useLockCountdown({
  selectedSeats,
  ttlSeconds = 300,
  onExpired,
}: UseLockCountdownOptions): UseLockCountdownReturn {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const onExpiredRef = useRef(onExpired);
  const firedRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  onExpiredRef.current = onExpired;

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setRemainingSeconds(null);
    firedRef.current = false;
  }, []);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    firedRef.current = false;

    if (selectedSeats.length === 0) {
      setRemainingSeconds(null);
      return;
    }

    const locksAt = selectedSeats
      .map((s) => (s.locked_at ? new Date(s.locked_at).getTime() : Infinity))
      .filter((t) => t < Infinity);

    if (locksAt.length === 0) {
      setRemainingSeconds(null);
      return;
    }

    const earliestLock = Math.min(...locksAt);
    const expiresAt = earliestLock + ttlSeconds * 1000;

    const tick = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.ceil((expiresAt - now) / 1000));
      setRemainingSeconds(diff);
      if (diff <= 0 && !firedRef.current) {
        firedRef.current = true;
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        onExpiredRef.current?.();
      }
    };

    tick();
    intervalRef.current = setInterval(tick, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [selectedSeats, ttlSeconds]);

  const formattedTime =
    remainingSeconds !== null
      ? `${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}`
      : null;

  return { remainingSeconds, formattedTime, stop };
}

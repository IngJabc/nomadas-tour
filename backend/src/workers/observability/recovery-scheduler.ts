/**
 * Gates stuck-recovery so it runs less often than the outbox poll loop.
 */
export interface RecoveryScheduler {
  /** True when enough time has elapsed since the last recovery attempt. */
  shouldRun(now?: Date): boolean;
  /** Mark that a recovery attempt just ran (success or empty). */
  markRan(now?: Date): void;
}

export function createRecoveryScheduler(options: {
  intervalMs: number;
  now?: () => Date;
}): RecoveryScheduler {
  const nowFn = options.now ?? (() => new Date());
  let lastRanAt: Date | null = null;

  return {
    shouldRun(now) {
      const t = now ?? nowFn();
      if (!lastRanAt) return true;
      return t.getTime() - lastRanAt.getTime() >= options.intervalMs;
    },
    markRan(now) {
      lastRanAt = now ?? nowFn();
    },
  };
}

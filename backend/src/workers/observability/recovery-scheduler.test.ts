import { describe, expect, it } from 'vitest';
import { createRecoveryScheduler } from './recovery-scheduler.js';

describe('WKR-006.1 — Recovery scheduler', () => {
  it('allows first run immediately then gates by interval', () => {
    let t = new Date('2026-08-05T15:00:00.000Z').getTime();
    const sched = createRecoveryScheduler({
      intervalMs: 60_000,
      now: () => new Date(t),
    });

    expect(sched.shouldRun()).toBe(true);
    sched.markRan();
    expect(sched.shouldRun()).toBe(false);

    t += 59_000;
    expect(sched.shouldRun()).toBe(false);

    t += 1_000;
    expect(sched.shouldRun()).toBe(true);
  });
});

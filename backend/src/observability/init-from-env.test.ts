import { beforeEach, describe, expect, it, vi } from 'vitest';

const initSentry = vi.fn();

vi.mock('./sentry.js', () => ({
  initSentry: (...args: unknown[]) => initSentry(...args),
}));

vi.mock('../config/env.js', () => ({
  env: {
    SENTRY_ENABLED: false,
    SENTRY_DSN: '',
    SENTRY_ENVIRONMENT: '',
    SENTRY_RELEASE: '',
    NODE_ENV: 'test',
  },
}));

describe('WKR-006.2 — initSentryFromEnv', () => {
  beforeEach(() => {
    initSentry.mockClear();
  });

  it('initializes worker service with enabled=false by default', async () => {
    const { initSentryFromEnv } = await import('./init-from-env.js');
    initSentryFromEnv('worker', { worker_name: 'nomadas-outbox-relay' });
    expect(initSentry).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        service: 'worker',
        defaultTags: { worker_name: 'nomadas-outbox-relay' },
      }),
    );
  });
});

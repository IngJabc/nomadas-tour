import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInit = vi.fn();
const mockCaptureException = vi.fn(() => 'event-1');
const mockCaptureMessage = vi.fn(() => 'msg-1');
const mockSetTags = vi.fn();
const mockSetContext = vi.fn();
const mockFlush = vi.fn(async () => true);
const mockWithScope = vi.fn((cb: (scope: any) => unknown) => {
  const scope = {
    setTags: vi.fn(),
    setContext: vi.fn(),
    setFingerprint: vi.fn(),
    setLevel: vi.fn(),
  };
  return cb(scope);
});

vi.mock('@sentry/node', () => ({
  init: (...args: unknown[]) => mockInit(...args),
  captureException: (...args: unknown[]) => mockCaptureException(...args),
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
  setTags: (...args: unknown[]) => mockSetTags(...args),
  setContext: (...args: unknown[]) => mockSetContext(...args),
  flush: (...args: unknown[]) => mockFlush(...args),
  withScope: (cb: (scope: any) => unknown) => mockWithScope(cb),
}));

describe('WKR-006.2 — Sentry wrapper', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockInit.mockClear();
    mockCaptureException.mockClear();
    mockCaptureMessage.mockClear();
    mockSetTags.mockClear();
    mockSetContext.mockClear();
    mockFlush.mockClear();
    mockWithScope.mockClear();
  });

  it('stays disabled when SENTRY_ENABLED is false', async () => {
    const sentry = await import('./sentry.js');
    sentry.resetSentryForTests();
    sentry.initSentry({
      enabled: false,
      dsn: 'https://example@sentry.io/1',
      environment: 'test',
      release: '1.0.0',
      service: 'api',
    });
    expect(sentry.isSentryEnabled()).toBe(false);
    expect(mockInit).not.toHaveBeenCalled();
    expect(sentry.captureException(new Error('x'))).toBeUndefined();
  });

  it('stays disabled when DSN is empty even if enabled', async () => {
    const sentry = await import('./sentry.js');
    sentry.resetSentryForTests();
    sentry.initSentry({
      enabled: true,
      dsn: '',
      environment: 'test',
      release: '1.0.0',
      service: 'worker',
    });
    expect(sentry.isSentryEnabled()).toBe(false);
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('initializes and captures exceptions when enabled', async () => {
    const sentry = await import('./sentry.js');
    sentry.resetSentryForTests();
    sentry.initSentry({
      enabled: true,
      dsn: 'https://examplePublicKey@o0.ingest.sentry.io/1',
      environment: 'staging',
      release: '1.2.3',
      service: 'worker',
      defaultTags: { worker_name: 'nomadas-outbox-relay' },
    });

    expect(sentry.isSentryEnabled()).toBe(true);
    expect(mockInit).toHaveBeenCalledOnce();
    expect(mockSetTags).toHaveBeenCalled();

    const id = sentry.captureException(new Error('boom'), {
      tags: {
        handler: 'reservation.created:1',
        event_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        contact_email: 'secret@example.com',
      },
      fingerprint: sentry.fingerprintWorkerFailure(
        'nomadas-outbox-relay',
        'handler',
        'reservation.created:1',
      ),
    });
    expect(id).toBe('event-1');
    expect(mockWithScope).toHaveBeenCalled();
    expect(mockCaptureException).toHaveBeenCalled();
  });

  it('shouldCaptureHttpStatus filters business errors', async () => {
    const sentry = await import('./sentry.js');
    expect(sentry.shouldCaptureHttpStatus(401)).toBe(false);
    expect(sentry.shouldCaptureHttpStatus(403)).toBe(false);
    expect(sentry.shouldCaptureHttpStatus(404)).toBe(false);
    expect(sentry.shouldCaptureHttpStatus(409)).toBe(false);
    expect(sentry.shouldCaptureHttpStatus(422)).toBe(false);
    expect(sentry.shouldCaptureHttpStatus(410)).toBe(false);
    expect(sentry.shouldCaptureHttpStatus(400)).toBe(false);
    expect(sentry.shouldCaptureHttpStatus(500)).toBe(true);
    expect(sentry.shouldCaptureHttpStatus(503)).toBe(true);
  });

  it('captureMessage is a no-op when disabled', async () => {
    const sentry = await import('./sentry.js');
    sentry.resetSentryForTests();
    sentry.initSentry({
      enabled: false,
      dsn: '',
      environment: 'test',
      release: '',
      service: 'api',
    });
    expect(sentry.captureMessage('hello')).toBeUndefined();
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('redactReservationLinkUrl strips 64-hex path tokens', async () => {
    const sentry = await import('./sentry.js');
    const token = 'a'.repeat(64);
    expect(
      sentry.redactReservationLinkUrl(
        `https://api.example.com/api/public/reservation-links/${token}`,
      ),
    ).toBe('https://api.example.com/api/public/reservation-links/[REDACTED]');
  });

  it('redactReservationLinkUrl strips ?token= query', async () => {
    const sentry = await import('./sentry.js');
    const token = 'b'.repeat(64);
    expect(
      sentry.redactReservationLinkUrl(
        `https://app.example.com/reservations/link?token=${token}`,
      ),
    ).toContain('token=%5BREDACTED%5D');
  });

  it('beforeSend redacts reservation-link tokens in request.url', async () => {
    const sentry = await import('./sentry.js');
    sentry.resetSentryForTests();
    sentry.initSentry({
      enabled: true,
      dsn: 'https://examplePublicKey@o0.ingest.sentry.io/1',
      environment: 'test',
      release: '1.0.0',
      service: 'api',
    });
    const token = 'c'.repeat(64);
    const initArg = mockInit.mock.calls[0]?.[0] as {
      beforeSend?: (event: { request?: { url?: string } }) => { request?: { url?: string } };
    };
    expect(initArg.beforeSend).toBeTypeOf('function');
    const event = initArg.beforeSend!({
      request: { url: `https://api.example.com/api/public/reservation-links/${token}` },
    });
    expect(event.request?.url).toContain('/reservation-links/[REDACTED]');
    expect(event.request?.url).not.toContain(token);

    const queryEvent = initArg.beforeSend!({
      request: { url: `https://app.example.com/reservations/link?token=${token}` },
    });
    expect(queryEvent.request?.url).not.toContain(token);
  });
});

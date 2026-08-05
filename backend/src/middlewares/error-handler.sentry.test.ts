import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { ForbiddenError, NotFoundError } from '../errors/index.js';

const captureException = vi.fn();
const shouldCaptureHttpStatus = vi.fn((code: number) => code >= 500);
const fingerprintHttpError = vi.fn((status: number, code?: string) => [
  'api',
  'http',
  String(status),
  code ?? 'INTERNAL_ERROR',
]);

vi.mock('../observability/sentry.js', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  shouldCaptureHttpStatus: (code: number) => shouldCaptureHttpStatus(code),
  fingerprintHttpError: (status: number, code?: string) =>
    fingerprintHttpError(status, code),
}));

describe('WKR-006.2 — errorHandler + Sentry', () => {
  beforeEach(() => {
    captureException.mockClear();
    shouldCaptureHttpStatus.mockClear();
    fingerprintHttpError.mockClear();
  });

  it('does not capture 403/404 business errors', async () => {
    const { errorHandler } = await import('./error-handler.js');
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    errorHandler(new ForbiddenError(), {} as Request, res, vi.fn());
    errorHandler(new NotFoundError(), {} as Request, res, vi.fn());
    expect(captureException).not.toHaveBeenCalled();
  });

  it('captures unexpected non-AppError as 500', async () => {
    const { errorHandler } = await import('./error-handler.js');
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    errorHandler(new Error('boom'), {} as Request, res, vi.fn());
    expect(captureException).toHaveBeenCalledOnce();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

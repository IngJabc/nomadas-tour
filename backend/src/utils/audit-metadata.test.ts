import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { auditRequestMetadata } from './audit-metadata.js';

describe('auditRequestMetadata', () => {
  it('includes source=api and safe request fields only', () => {
    const req = {
      ip: '203.0.113.10',
      get: (name: string) =>
        name.toLowerCase() === 'user-agent' ? 'VitestAgent/1.0' : undefined,
      headers: {
        authorization: 'Bearer secret-token',
        cookie: 'session=abc',
      },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    expect(auditRequestMetadata(req)).toEqual({
      source: 'api',
      ip: '203.0.113.10',
      user_agent: 'VitestAgent/1.0',
    });
  });

  it('never copies authorization or cookie headers', () => {
    const req = {
      get: () => undefined,
      headers: {
        authorization: 'Bearer secret-token',
        cookie: 'session=abc',
      },
    } as unknown as Request;

    const meta = auditRequestMetadata(req) as Record<string, unknown>;
    expect(meta).toEqual({ source: 'api' });
    expect(JSON.stringify(meta).toLowerCase()).not.toMatch(
      /authorization|cookie|bearer|token/,
    );
  });
});

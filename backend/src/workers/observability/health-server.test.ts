import { afterEach, describe, expect, it } from 'vitest';
import {
  startWorkerHealthServer,
  type WorkerHealthServer,
} from './health-server.js';

describe('WKR-006.4 — Worker health server', () => {
  let server: WorkerHealthServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('GET /healthz returns 200 with expected JSON', async () => {
    const startedAt = new Date('2026-08-07T12:00:00.000Z');
    server = await startWorkerHealthServer({
      port: 0,
      workerVersion: '1.0.0',
      startedAt,
      pid: 4242,
      now: () => new Date('2026-08-07T12:02:00.000Z'),
      host: '127.0.0.1',
    });

    const res = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      status: 'ok',
      service: 'nomadas-outbox-relay',
      worker_version: '1.0.0',
      uptime_seconds: 120,
      pid: 4242,
    });
  });

  it('closes cleanly after shutdown', async () => {
    server = await startWorkerHealthServer({
      port: 0,
      workerVersion: '1.0.0',
      startedAt: new Date(),
      host: '127.0.0.1',
    });
    const port = server.port;
    await server.close();
    server = null;

    await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow();
  });
});

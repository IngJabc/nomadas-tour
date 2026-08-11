import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** Same service id as DEFAULT_WORKER_NAME (avoid circular import via index). */
const DEFAULT_SERVICE = 'nomadas-outbox-relay';

export interface WorkerHealthPayload {
  status: 'ok';
  service: string;
  worker_version: string;
  uptime_seconds: number;
  pid: number;
}

export interface WorkerHealthServer {
  /** Bound port (useful when listening on 0 in tests). */
  port: number;
  close(): Promise<void>;
}

export interface StartWorkerHealthServerOptions {
  port: number;
  workerName?: string;
  workerVersion: string;
  startedAt: Date;
  pid?: number;
  now?: () => Date;
  host?: string;
}

/**
 * Minimal Node `http` health server for platforms that require an open port
 * (e.g. Render Free Web Service). No Express, no DB checks.
 */
export function startWorkerHealthServer(
  options: StartWorkerHealthServerOptions,
): Promise<WorkerHealthServer> {
  const workerName = options.workerName ?? DEFAULT_SERVICE;
  const pid = options.pid ?? process.pid;
  const nowFn = options.now ?? (() => new Date());
  const host = options.host ?? '0.0.0.0';

  const server = http.createServer((req, res) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && (req.url === '/healthz' || req.url === '/healthz/')) {
      const uptime_seconds = Math.max(
        0,
        Math.floor((nowFn().getTime() - options.startedAt.getTime()) / 1000),
      );
      const body: WorkerHealthPayload = {
        status: 'ok',
        service: workerName,
        worker_version: options.workerVersion,
        uptime_seconds,
        pid,
      };
      const json = JSON.stringify(body);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(json),
      });
      res.end(json);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'not_found' }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, host, () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        close: () =>
          new Promise((resClose, rejClose) => {
            server.close((err) => {
              if (err) rejClose(err);
              else resClose();
            });
          }),
      });
    });
  });
}

import type { WorkerMetricsSnapshot } from './metrics.js';

export type WorkerLogLevel = 'info' | 'warn' | 'error';

export interface WorkerLogFields {
  [key: string]: unknown;
  event_id?: string;
  event_type?: string;
  event_version?: number;
  aggregate_id?: string;
  aggregate_type?: string;
  tenant_id?: string | null;
  agency_id?: string | null;
  handler?: string;
  duration_ms?: number;
  status?: string;
  attempts?: number;
  reason?: string;
  error?: string;
  claimed?: number;
  recovered?: number;
  metrics?: WorkerMetricsSnapshot;
}

/** Keys that must never appear in worker logs (defense in depth). */
const SENSITIVE_KEY_PATTERN =
  /^(email|contact_email|password|phone|document|documento|qr_code|ticket_code|name|nombre|passenger|payload|to|recipient)$/i;

export interface WorkerLoggerOptions {
  workerName: string;
  service?: string;
  now?: () => Date;
  write?: (line: string) => void;
}

export interface WorkerLogger {
  info(event: string, fields?: WorkerLogFields): void;
  warn(event: string, fields?: WorkerLogFields): void;
  error(event: string, fields?: WorkerLogFields): void;
  child(extra: WorkerLogFields): WorkerLogger;
}

function scrubFields(fields: WorkerLogFields | undefined): Record<string, unknown> {
  if (!fields) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    if (value === undefined) continue;
    // Never dump nested objects that look like full payloads
    if (key === 'data' || key === 'body') continue;
    out[key] = value;
  }
  return out;
}

export function createWorkerLogger(options: WorkerLoggerOptions): WorkerLogger {
  const service = options.service ?? 'worker';
  const workerName = options.workerName;
  const now = options.now ?? (() => new Date());
  const write = options.write ?? ((line: string) => console.log(line));

  function emit(level: WorkerLogLevel, event: string, fields?: WorkerLogFields) {
    const line = JSON.stringify({
      timestamp: now().toISOString(),
      level,
      service,
      worker_name: workerName,
      event,
      ...scrubFields(fields),
    });
    write(line);
  }

  const logger: WorkerLogger = {
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    child(extra) {
      return {
        info: (event, fields) => emit('info', event, { ...extra, ...fields }),
        warn: (event, fields) => emit('warn', event, { ...extra, ...fields }),
        error: (event, fields) => emit('error', event, { ...extra, ...fields }),
        child: (more) => logger.child({ ...extra, ...more }),
      };
    },
  };

  return logger;
}

/** Parse a log line back to object (tests). */
export function parseWorkerLogLine(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>;
}

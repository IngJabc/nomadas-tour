import { describe, expect, it } from 'vitest';
import { createWorkerLogger, parseWorkerLogLine } from './logger.js';
import { correlationFromRow } from './context.js';
import type { OutboxEventRow } from '../../events/types.js';

function sampleRow(overrides: Partial<OutboxEventRow> = {}): OutboxEventRow {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    event_type: 'reservation.created',
    event_version: 1,
    aggregate_type: 'reservation',
    aggregate_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    tenant_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    payload: {
      reservation_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      trip_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      agency_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    },
    status: 'processing',
    attempts: 2,
    available_at: '2026-08-05T12:00:00.000Z',
    processed_at: null,
    error_message: null,
    created_at: '2026-08-05T12:00:00.000Z',
    updated_at: '2026-08-05T12:00:00.000Z',
    ...overrides,
  };
}

describe('WKR-006.1 — Worker logger', () => {
  it('emits JSON with required metadata fields', () => {
    const lines: string[] = [];
    const logger = createWorkerLogger({
      workerName: 'nomadas-outbox-relay',
      now: () => new Date('2026-08-05T15:00:00.000Z'),
      write: (line) => lines.push(line),
    });

    const corr = correlationFromRow(sampleRow());
    logger.info('outbox_completed', {
      ...corr,
      duration_ms: 42,
      status: 'completed',
      reason: 'sent',
    });

    expect(lines).toHaveLength(1);
    const parsed = parseWorkerLogLine(lines[0]!);
    expect(parsed).toMatchObject({
      timestamp: '2026-08-05T15:00:00.000Z',
      level: 'info',
      service: 'worker',
      worker_name: 'nomadas-outbox-relay',
      event: 'outbox_completed',
      event_id: corr.event_id,
      event_type: 'reservation.created',
      event_version: 1,
      aggregate_id: corr.aggregate_id,
      tenant_id: corr.tenant_id,
      agency_id: corr.agency_id,
      handler: 'reservation.created:1',
      duration_ms: 42,
      status: 'completed',
    });
  });

  it('scrubs sensitive keys and never logs payload/email/document', () => {
    const lines: string[] = [];
    const logger = createWorkerLogger({
      workerName: 'nomadas-outbox-relay',
      write: (line) => lines.push(line),
    });

    logger.info('outbox_completed', {
      event_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      email: 'secret@example.com',
      contact_email: 'secret@example.com',
      document: 'V123',
      nombre: 'Juan',
      passenger: 'Juan',
      qr_code: 'QR-1',
      payload: { contact_email: 'x@y.z' },
      to: 'secret@example.com',
      status: 'completed',
    });

    const parsed = parseWorkerLogLine(lines[0]!);
    const json = lines[0]!;
    expect(parsed.email).toBeUndefined();
    expect(parsed.contact_email).toBeUndefined();
    expect(parsed.document).toBeUndefined();
    expect(parsed.nombre).toBeUndefined();
    expect(parsed.passenger).toBeUndefined();
    expect(parsed.qr_code).toBeUndefined();
    expect(parsed.payload).toBeUndefined();
    expect(parsed.to).toBeUndefined();
    expect(json).not.toContain('secret@example.com');
    expect(json).not.toContain('V123');
    expect(json).not.toContain('Juan');
  });
});

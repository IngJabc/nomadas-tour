import { describe, expect, it, vi } from 'vitest';
import type { OutboxEventRow } from '../../events/types.js';
import type { OutboxHandler } from '../outbox/types.js';
import { composeHandlers } from './compose.js';

function row(): OutboxEventRow {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    event_type: 'reservation.created',
    event_version: 1,
    aggregate_type: 'reservation',
    aggregate_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    tenant_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    payload: {
      reservation_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      trip_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      agency_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    },
    status: 'processing',
    attempts: 1,
    available_at: '2026-08-08T12:00:00.000Z',
    processed_at: null,
    error_message: null,
    created_at: '2026-08-08T12:00:00.000Z',
    updated_at: '2026-08-08T12:00:00.000Z',
  };
}

describe('composeHandlers', () => {
  it('requires at least one handler', () => {
    expect(() => composeHandlers()).toThrow(
      'composeHandlers requires at least one handler',
    );
  });

  it('runs all handlers sequentially and completes when all complete', async () => {
    const order: string[] = [];
    const first: OutboxHandler = vi.fn<OutboxHandler>(async () => {
      order.push('first');
      return { kind: 'completed', reason: 'sent' };
    });
    const second: OutboxHandler = vi.fn<OutboxHandler>(async () => {
      order.push('second');
      return { kind: 'completed', reason: 'skipped_effect_disabled' };
    });

    await expect(composeHandlers(first, second)(row())).resolves.toEqual({
      kind: 'completed',
      reason: 'sent',
    });
    expect(order).toEqual(['first', 'second']);
  });

  it('prefers delivered over skip outcomes', async () => {
    const skipped: OutboxHandler = async () => ({
      kind: 'completed',
      reason: 'skipped_no_agencies',
    });
    const delivered: OutboxHandler = async () => ({
      kind: 'completed',
      reason: 'delivered',
    });

    await expect(composeHandlers(skipped, delivered)(row())).resolves.toEqual({
      kind: 'completed',
      reason: 'delivered',
    });
  });

  it('prefers already-delivered outcomes over pure skips', async () => {
    const disabled: OutboxHandler = async () => ({
      kind: 'completed',
      reason: 'skipped_effect_disabled',
    });
    const alreadyDelivered: OutboxHandler = async () => ({
      kind: 'completed',
      reason: 'already_delivered',
    });

    await expect(
      composeHandlers(disabled, alreadyDelivered)(row()),
    ).resolves.toEqual({
      kind: 'completed',
      reason: 'already_delivered',
    });
  });

  it('preserves the first reason when all completed outcomes are skips', async () => {
    const noEmail: OutboxHandler = async () => ({
      kind: 'completed',
      reason: 'skipped_no_email',
    });
    const disabled: OutboxHandler = async () => ({
      kind: 'completed',
      reason: 'skipped_effect_disabled',
    });

    await expect(composeHandlers(noEmail, disabled)(row())).resolves.toEqual({
      kind: 'completed',
      reason: 'skipped_no_email',
    });
  });

  it('returns requeue unchanged after running later handlers', async () => {
    const later: OutboxHandler = vi.fn<OutboxHandler>(async () => ({
      kind: 'completed',
      reason: 'delivered',
    }));
    const requeue: OutboxHandler = async () => ({
      kind: 'requeue',
      reason: 'dependency_pending',
      delayMs: 750,
    });

    await expect(composeHandlers(requeue, later)(row())).resolves.toEqual({
      kind: 'requeue',
      reason: 'dependency_pending',
      delayMs: 750,
    });
    expect(later).toHaveBeenCalledOnce();
  });

  it('returns permanent failure unchanged after running later handlers', async () => {
    const later: OutboxHandler = vi.fn<OutboxHandler>(async () => ({
      kind: 'completed',
      reason: 'delivered',
    }));
    const failed: OutboxHandler = async () => ({
      kind: 'failed',
      reason: 'invalid payload',
      permanent: true,
    });

    await expect(composeHandlers(failed, later)(row())).resolves.toEqual({
      kind: 'failed',
      reason: 'invalid payload',
      permanent: true,
    });
    expect(later).toHaveBeenCalledOnce();
  });

  it('returns retryable failure unchanged after running later handlers', async () => {
    const later: OutboxHandler = vi.fn<OutboxHandler>(async () => ({
      kind: 'completed',
      reason: 'delivered',
    }));
    const failed: OutboxHandler = async () => ({
      kind: 'failed',
      reason: 'temporary dependency failure',
      permanent: false,
    });

    await expect(composeHandlers(failed, later)(row())).resolves.toEqual({
      kind: 'failed',
      reason: 'temporary dependency failure',
      permanent: false,
    });
    expect(later).toHaveBeenCalledOnce();
  });

  it('prioritizes permanent failure over requeue', async () => {
    const requeue: OutboxHandler = async () => ({
      kind: 'requeue',
      reason: 'dependency_pending',
      delayMs: 750,
    });
    const permanent: OutboxHandler = async () => ({
      kind: 'failed',
      reason: 'invalid payload',
      permanent: true,
    });

    await expect(composeHandlers(requeue, permanent)(row())).resolves.toEqual({
      kind: 'failed',
      reason: 'invalid payload',
      permanent: true,
    });
  });

  it('prioritizes requeue over retryable failure', async () => {
    const retryable: OutboxHandler = async () => ({
      kind: 'failed',
      reason: 'temporary dependency failure',
      permanent: false,
    });
    const requeue: OutboxHandler = async () => ({
      kind: 'requeue',
      reason: 'dependency_pending',
      delayMs: 750,
    });

    await expect(composeHandlers(retryable, requeue)(row())).resolves.toEqual({
      kind: 'requeue',
      reason: 'dependency_pending',
      delayMs: 750,
    });
  });

  it('propagates handler exceptions to the relay boundary', async () => {
    const later = vi.fn<OutboxHandler>();
    const throwing: OutboxHandler = async () => {
      throw new Error('unexpected');
    };

    await expect(composeHandlers(throwing, later)(row())).rejects.toThrow(
      'unexpected',
    );
    expect(later).not.toHaveBeenCalled();
  });

  it('is retry-safe when completed sub-handlers are idempotent', async () => {
    let delivered = false;
    let externalEffectCount = 0;
    let secondAttempt = 0;

    const idempotentDelivery: OutboxHandler = async () => {
      if (delivered) {
        return { kind: 'completed', reason: 'already_delivered' };
      }
      delivered = true;
      externalEffectCount += 1;
      return { kind: 'completed', reason: 'delivered' };
    };
    const retryingFanout: OutboxHandler = async () => {
      secondAttempt += 1;
      if (secondAttempt === 1) {
        return {
          kind: 'requeue',
          reason: 'fanout_pending',
          delayMs: 1000,
        };
      }
      return { kind: 'completed', reason: 'delivered' };
    };
    const composite = composeHandlers(idempotentDelivery, retryingFanout);

    await expect(composite(row())).resolves.toEqual({
      kind: 'requeue',
      reason: 'fanout_pending',
      delayMs: 1000,
    });
    await expect(composite(row())).resolves.toEqual({
      kind: 'completed',
      reason: 'delivered',
    });
    expect(externalEffectCount).toBe(1);
  });
});

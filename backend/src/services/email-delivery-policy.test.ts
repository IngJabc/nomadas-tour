import { describe, expect, it } from 'vitest';
import {
  evaluateDelivery,
  normalizeEmailDeliveryMode,
  parseAllowedRecipients,
} from './email-delivery-policy.js';

describe('OPS-EMAIL-001 — email-delivery-policy', () => {
  describe('parseAllowedRecipients', () => {
    it('trims, lowercases, drops empties, and dedupes', () => {
      expect(
        parseAllowedRecipients('  A@Example.COM , b@x.com,,B@x.com, '),
      ).toEqual(['a@example.com', 'b@x.com']);
    });

    it('returns empty array for empty/undefined', () => {
      expect(parseAllowedRecipients('')).toEqual([]);
      expect(parseAllowedRecipients(undefined)).toEqual([]);
      expect(parseAllowedRecipients(null)).toEqual([]);
    });
  });

  describe('normalizeEmailDeliveryMode', () => {
    it('defaults to normal', () => {
      expect(normalizeEmailDeliveryMode(undefined)).toBe('normal');
      expect(normalizeEmailDeliveryMode(null)).toBe('normal');
      expect(normalizeEmailDeliveryMode('')).toBe('normal');
    });

    it('accepts case-insensitive modes with whitespace', () => {
      expect(normalizeEmailDeliveryMode('  RESTRICTED ')).toBe('restricted');
      expect(normalizeEmailDeliveryMode('Disabled')).toBe('disabled');
    });

    it('rejects invalid modes', () => {
      expect(() => normalizeEmailDeliveryMode('bogus')).toThrow(
        /Invalid EMAIL_DELIVERY_MODE/,
      );
    });
  });

  describe('evaluateDelivery', () => {
    it('normal → send for any recipient', () => {
      expect(
        evaluateDelivery('anyone@example.com', {
          mode: 'normal',
          allowedRecipients: [],
        }),
      ).toEqual({ action: 'send' });
    });

    it('restricted + allowed → send', () => {
      expect(
        evaluateDelivery('Allowed@Example.com', {
          mode: 'restricted',
          allowedRecipients: ['allowed@example.com'],
        }),
      ).toEqual({ action: 'send' });
    });

    it('restricted + blocked → skip restricted', () => {
      expect(
        evaluateDelivery('other@example.com', {
          mode: 'restricted',
          allowedRecipients: ['allowed@example.com'],
        }),
      ).toEqual({ action: 'skip', reason: 'restricted' });
    });

    it('restricted + empty allowlist → fail-safe skip', () => {
      expect(
        evaluateDelivery('anyone@example.com', {
          mode: 'restricted',
          allowedRecipients: [],
        }),
      ).toEqual({ action: 'skip', reason: 'restricted' });
    });

    it('disabled → skip disabled', () => {
      expect(
        evaluateDelivery('allowed@example.com', {
          mode: 'disabled',
          allowedRecipients: ['allowed@example.com'],
        }),
      ).toEqual({ action: 'skip', reason: 'disabled' });
    });
  });
});

/**
 * OPS-EMAIL-001 — Temporary Resend recipient delivery policy.
 * Single decision point used by EmailService before calling Resend.
 */

export type EmailDeliveryMode = 'normal' | 'restricted' | 'disabled';

export type EmailDeliveryDecision =
  | { action: 'send' }
  | { action: 'skip'; reason: 'restricted' | 'disabled' };

export function parseAllowedRecipients(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const email = part.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export function normalizeEmailDeliveryMode(
  raw: string | undefined | null,
): EmailDeliveryMode {
  const mode = (raw ?? '').trim().toLowerCase();
  if (!mode) return 'normal';
  if (mode === 'normal' || mode === 'restricted' || mode === 'disabled') {
    return mode;
  }
  throw new Error(
    `Invalid EMAIL_DELIVERY_MODE: ${JSON.stringify(raw)}. Expected normal|restricted|disabled`,
  );
}

export function evaluateDelivery(
  to: string,
  options: {
    mode: EmailDeliveryMode;
    allowedRecipients: readonly string[];
  },
): EmailDeliveryDecision {
  if (options.mode === 'disabled') {
    return { action: 'skip', reason: 'disabled' };
  }

  if (options.mode === 'restricted') {
    const normalizedTo = to.trim().toLowerCase();
    if (
      options.allowedRecipients.length === 0 ||
      !options.allowedRecipients.includes(normalizedTo)
    ) {
      return { action: 'skip', reason: 'restricted' };
    }
  }

  return { action: 'send' };
}

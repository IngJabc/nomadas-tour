/** Exponential backoff capped at 5 minutes. */
export function retryDelayMs(attempts: number, baseMs: number): number {
  const exp = Math.min(attempts, 8);
  return Math.min(baseMs * 2 ** Math.max(exp - 1, 0), 5 * 60_000);
}

/**
 * Pure helpers for stuck `processing` detection (WKR-006.1).
 * DB recovery uses recover_stuck_outbox_events (SKIP LOCKED).
 */

export function isStaleProcessing(
  row: { status: string; updated_at: string },
  staleMs: number,
  now: Date = new Date(),
): boolean {
  if (row.status !== 'processing') return false;
  const updated = new Date(row.updated_at).getTime();
  if (Number.isNaN(updated)) return false;
  return now.getTime() - updated >= staleMs;
}

export function selectStaleProcessingIds(
  rows: Array<{ id: string; status: string; updated_at: string }>,
  staleMs: number,
  limit: number,
  now: Date = new Date(),
): string[] {
  return rows
    .filter((r) => isStaleProcessing(r, staleMs, now))
    .sort(
      (a, b) =>
        new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(),
    )
    .slice(0, Math.max(limit, 0))
    .map((r) => r.id);
}

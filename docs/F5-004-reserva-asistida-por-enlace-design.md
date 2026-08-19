# F5-004: Reserva Asistida por Enlace — Design Document v1.3

> **Status:** DESIGN COMPLETE — VERIFIED READY
> **Date:** 2026-08-18 (v1.3 second adversarial audit)
> **Supersedes:** v1.2
> **v1.3 closed:** B1–B13 plus derived write-paths (outbox workers, audit/notification CHECKs, public RPCs, `update_trip` active-link seats, wizard TTL 600s). Do not treat v1.2 as implementable.

---

## Decision Update

Final product decisions closed with system owner:

| Decision | Value | Status |
|---|---|---|
| Link TTL | 15 minutes | CONFIRMED |
| Normal wizard lock | 10 minutes | CONFIRMED |
| Link flow lock | 15 minutes | CONFIRMED |
| Lock behavior | Existing locks extended, not recreated | CONFIRMED |
| Link expiry vs seat release | Independent — expiry does NOT release seats | CONFIRMED |
| Save semantics | Full-state replacement (not merge) | CONFIRMED |
| All passengers required | Only at confirmation time | CONFIRMED |
| Agency can edit | Yes, via dedicated endpoint, before confirmation | CONFIRMED |
| Regenerate inherits draft | Yes, same seats, new token, data carried forward | CONFIRMED |
| Trip changes invalidate link | Yes, lazy detection via trip_snapshot | CONFIRMED |
| Public page shows | logo, name, destination, date, time, seats | CONFIRMED |
| Public realtime | None | CONFIRMED |
| Price on public page | None | CONFIRMED |
| Seat uniqueness | DB-enforced via denormalized is_active + partial unique index | CONFIRMED |
| Atomicity | Link-specific validation layer + shared reservation creation core | CONFIRMED |
| Confirmation seat state | Must be locked by **a user of the same agency** AND lock_expires_at > NOW() | CONFIRMED |
| Create link prerequisite | Seats must already be locked by the **creating user** (wizard locker) | CONFIRMED |
| Confirmation reads link_data | From DB, not from request body | CONFIRMED |
| Public passenger key | `seat_code` only — never seat UUID in public JSON or persisted `link_data` | CONFIRMED |
| Trip FK | `ON DELETE RESTRICT` — historical link rows are not cascaded away | CONFIRMED |
| Wizard lock TTL change | **Breaking vs today:** 300s → 600s. Wizard lock duration changes. Seat lock write path changes (`lock_expires_at`). | CONFIRMED |
| passenger_data_saved | **First public save only** (dedup by link_id). Agency PATCH does not emit. | CONFIRMED |
| Cancel after link TTL | Allowed while persisted `status = 'active'`. Releases only locks owned by the agency. | CONFIRMED |

---

## CONFIRMED vs PROPOSED vs NEEDS VALIDATION Legend

- **[CONFIRMED]** = Business decision already closed by product owner, or system behavior verified against code/schema/migration
- **[PROPOSED]** = Technical solution recommended by this document (Cursor implements unless overridden)
- **[NEEDS VALIDATION]** = Existing system behavior that must be verified before implementing

---

## Section 1: Overview & Goals

### Problem

Agencies currently must enter all passenger data themselves when creating a reservation. For trips where the passenger self-manages, the agency needs a way to delegate data entry to the passenger while retaining control over seat selection and final confirmation.

### Solution

A **shareable link** that lets the agency:
1. Select seats and lock them (10m normal wizard → extended to 15m when link is created)
2. Generate a link with a 15-minute TTL
3. Share the link with the passenger
4. Passenger fills in their own data (name, document, phone) on a public page
5. Agency reviews, corrects if needed, and confirms the reservation

### Key Invariants

| # | Invariant | Status |
|---|-----------|--------|
| 1 | Link TTL = 15 minutes with visible countdown | CONFIRMED |
| 2 | Link ≠ reservation confirmation. Link is a draft-sharing mechanism. | CONFIRMED |
| 3 | 1..N seats per link. Same reservant completes all passenger data. | CONFIRMED |
| 4 | Allowed: name, document, phone. NOT editable: trip, route, agency, seats, price. | CONFIRMED |
| 5 | Multiple active links per (trip, agency) allowed IF seat sets are disjoint. | CONFIRMED |
| 6 | Single-seat invariant: a seat cannot appear in more than one active link. | CONFIRMED |
| 7 | Link expiry does NOT manually release seats (follows normal lock lifecycle). | CONFIRMED |
| 8 | Agency cancel of `status=active` → link `cancelled`. Seats released **only if** still `locked` by a user of that agency. | CONFIRMED |
| 9 | Agency confirms → link invalid + seats converted to reservation. | CONFIRMED |
| 10 | Trip changes → link invalidated lazily on next access (GET/save/confirm/regenerate/PATCH/list). | CONFIRMED |
| 11 | No realtime for public page. Polling or manual refresh. | CONFIRMED |
| 12 | Token = opaque, high-entropy, SHA-256 hashed in DB. Raw token never persisted. Raw token never emitted in app logs, Sentry `request.url`, or error bodies. | CONFIRMED |
| 13 | Normal wizard lock = **10 minutes (600s)**. Link flow lock = 15 minutes (900s). Existing locks extended from NOW(). | CONFIRMED |
| 14 | Save = full-state replacement. No merge. Last-write-wins. | CONFIRMED |
| 15 | Complete data required only at confirmation time. | CONFIRMED |
| 16 | Agency can edit/correct passenger data before confirmation via dedicated endpoint. | CONFIRMED |
| 17 | Regenerating a link uses the same seats and inherits draft data. | CONFIRMED |
| 18 | Seat uniqueness enforced at database level, not application-only. | CONFIRMED |
| 19 | All link lifecycle operations are transactional. | CONFIRMED |
| 20 | Public page shows only: agency logo, agency name, destination, date, time, seat codes. Public JSON never includes seat UUIDs, `link_id`, `trip_id`, `agency_id`. | CONFIRMED |
| 21 | Confirmation reads link_data from DB, not from request body. | CONFIRMED |
| 22 | Create link requires seats already locked by the creating user. | CONFIRMED |
| 23 | Confirmation requires seats locked by **any user of the same agency** AND lock_expires_at > NOW(). | CONFIRMED |
| 24 | Confirm rejects `departure_time <= NOW()` (`ERR_TRIP_DEPARTED`) even if snapshot fields are unchanged. | CONFIRMED |
| 25 | `link_data.passengers[].seat_code` is the only passenger↔seat key. Confirm maps `ORDER BY seats.seat_code`. | CONFIRMED |

### Scope

- **In scope:** Backend (new tables, new RPCs, new endpoints), frontend (public page + agency link UI), migration.
- **Out of scope:** Email/SMS link delivery, passenger payment, seat price negotiation, Realtime on public page.

---

## Section 2: Token Generation & Storage

### Pattern

Matches existing `agency_invitations` (`backend/src/utils/token.ts:4-6`) and `password_resets` (`backend/src/services/auth.service.ts:72`).

```typescript
import crypto from 'node:crypto';
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex'); // 64-char hex
}
```

### Storage [CONFIRMED]

| What | How |
|---|---|
| Raw token | Never stored. Returned once to agency on creation. |
| SHA-256 hash | Stored in `reservation_links.token_hash`. `TEXT NOT NULL UNIQUE`. |
| Validation | Lookup by `token_hash` only, then branch on `status` and TTL. Do **not** hide confirmed/cancelled behind a 404 by ANDing `status = 'active'` in the lookup. |

No separate index needed — `UNIQUE` constraint creates an implicit unique index.

---

## Section 3: Link Table Schema

### `reservation_links` [PROPOSED — new table]

```sql
CREATE TABLE reservation_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    TEXT NOT NULL UNIQUE,
  trip_id       UUID NOT NULL REFERENCES trips(id) ON DELETE RESTRICT,
  agency_id     UUID NOT NULL REFERENCES agencies(id),
  created_by    UUID NOT NULL REFERENCES auth.users(id),
  status        TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'confirmed', 'cancelled')),
  expires_at    TIMESTAMPTZ NOT NULL,
  link_data     JSONB NOT NULL DEFAULT '{}'::jsonb,
  trip_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rl_trip_id ON reservation_links(trip_id);
CREATE INDEX idx_rl_agency_id ON reservation_links(agency_id);
CREATE INDEX idx_rl_status ON reservation_links(status);
```

### `trip_snapshot` column [CONFIRMED]

Snapshot of trip fields at link creation time. Used for change detection (Section 18).

```json
{
  "departure_time": "2025-01-15T08:00:00Z",
  "route_id": "uuid",
  "vehicle_type": "bus",
  "capacity": 31,
  "status": "active"
}
```

### `link_data` JSONB [CONFIRMED — full-state replacement]

```json
{
  "booker_name": "Juan Pérez",
  "booker_document": "12345678",
  "booker_phone": "+59899123456",
  "passengers": [
    { "seat_code": "A1", "name": "Juan Pérez", "document": "12345678", "phone": "+59899123456" }
  ]
}
```

**Persisted and public `link_data` use the same shape.** The only seat key is `seat_code` (the human seat label). **Never persist or return `seat_id` UUIDs in `link_data`.** Internal seat identity lives only in `reservation_link_seats.seat_id`.

**Save semantics:** The client sends the full current state of the form on every save. The backend replaces `link_data` entirely. No merge. Last-write-wins.

**Authorization of seats:** The server loads authorized `seat_code`s from `reservation_link_seats.seat_code` (denormalized). Client `seat_code`s are accepted only if they match that set exactly (same count, every code present). Extra or unknown codes → `ERR_SEAT_NOT_IN_LINK`.

**Confirm mapping (canonical):**

```sql
SELECT rls.seat_id, rls.seat_code
FROM reservation_link_seats rls
WHERE rls.link_id = p_link_id
ORDER BY rls.seat_code;
```

For each row, take the passenger object with the same `seat_code`. Missing passenger object, count mismatch, or `seat_id IS NULL` → `ERR_PASSENGER_INCOMPLETE` / `ERR_SEAT_NOT_IN_LINK` / `ERR_SEAT_INVALID_LOCK`. Arrays passed to `create_reservation_core` follow this `ORDER BY rls.seat_code` order. `seat_id` is resolved internally; it never appears in `link_data`.

### `reservation_link_seats` [PROPOSED — new table]

```sql
CREATE TABLE reservation_link_seats (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id    UUID NOT NULL REFERENCES reservation_links(id) ON DELETE CASCADE,
  seat_id    UUID REFERENCES seats(id) ON DELETE SET NULL,
  seat_code  TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(link_id, seat_code)
);

CREATE INDEX idx_rls_link_id ON reservation_link_seats(link_id);
CREATE INDEX idx_rls_seat_id ON reservation_link_seats(seat_id);
```

### Seat uniqueness enforcement [CONFIRMED — denormalized is_active + partial unique index]

The cross-table partial unique index is invalid in PostgreSQL (partial index predicates cannot reference other tables). Solution: denormalized `is_active` column maintained by triggers.

```sql
-- Partial unique index (DB-level enforcement)
CREATE UNIQUE INDEX idx_reservation_link_seats_active_seat
  ON public.reservation_link_seats (seat_id)
  WHERE is_active = TRUE;
```

**FK `trip_id ON DELETE RESTRICT` [CONFIRMED — B1]:** Deleting a trip (or a route that would cascade-delete trips, `011_create_all.sql:64`) **fails** while `reservation_links` rows exist. Historical link rows are not deleted. Product path for “viaje ya no existe” is trip **status** change (`cancelled`/`completed`/`archived`), detected via `trip_snapshot`. Defense in depth: if `trips` row is missing anyway (restore split), public GET/confirm treat it as `TRIP_MISSING` (410) and lazy-expire the link **without** requiring CASCADE.

**FK `seat_id ON DELETE SET NULL` + denormalized `seat_code`:** `update_trip` (`057:302`) and the service-layer shrink (`superadmin.service.ts`) **DELETE** excess seats. `ON DELETE RESTRICT` would block capacity shrink for historical (already expired) links. Therefore:

- Persist `seat_code` at insert (copy from `seats.seat_code`). Public GET and mapping use this column; they do not require the `seats` row to still exist.
- `seat_id` may become NULL if the seat row is later deleted.
- Partial unique index remains on `seat_id WHERE is_active` (NULL `seat_id` is not unique-conflicting).
- **Required write-path on existing `update_trip` / capacity shrink:** treat `reservation_link_seats.is_active = TRUE` as in-use even when `seats.status = 'available'` (lock already cleaned, link not yet lazy-expired):

```sql
SELECT count(*) INTO v_active_links
FROM reservation_link_seats rls
JOIN seats s ON s.id = rls.seat_id
WHERE s.trip_id = p_trip_id
  AND s.seat_code = ANY(v_excess)
  AND rls.is_active = TRUE;

IF v_active_links > 0 THEN
  RAISE EXCEPTION 'ERR_SEATS_IN_USE: No se puede reducir capacidad: hay un enlace activo en esos asientos';
END IF;
```

Mirror the same check in `superadmin.service.ts` if that path still deletes seats. Active locks already fail the existing `status <> 'available'` check.

**Three-layer defense:**

| Layer | Mechanism | Role |
|---|---|---|
| 1 | Partial unique index on `is_active` | DB-native serialization. The unique violation occurs when the trigger **UPDATE**s `is_active` to TRUE, not on the initial INSERT (`DEFAULT FALSE`). |
| 2 | RPC catches `unique_violation` and ROLLBACK | Graceful `ERR_SEAT_ACTIVE_LINK`. Do **not** use `INSERT ON CONFLICT (link_id, seat_id)` for this — that UNIQUE is per-link, not cross-link. |
| 3 | `SELECT ... FOR UPDATE` on `seats` in RPC | Defense-in-depth with rich error messages. |

### `is_active` sync triggers [PROPOSED]

```sql
-- Trigger 1: sync on seat-link row insert/update
CREATE OR REPLACE FUNCTION public.trg_sync_seat_link_active()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.reservation_link_seats rls
  SET is_active = (SELECT rl.status = 'active' FROM public.reservation_links rl WHERE rl.id = rls.link_id)
  WHERE rls.id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_active_on_seat_link ON public.reservation_link_seats;
CREATE TRIGGER trg_sync_active_on_seat_link
  AFTER INSERT OR UPDATE OF link_id
  ON public.reservation_link_seats
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_seat_link_active();

-- Trigger 2: sync on link status change
CREATE OR REPLACE FUNCTION public.trg_sync_link_status_to_seats()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.reservation_link_seats rls
    SET is_active = (NEW.status = 'active')
    WHERE rls.link_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_link_status ON public.reservation_links;
CREATE TRIGGER trg_sync_link_status
  AFTER UPDATE OF status
  ON public.reservation_links
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_link_status_to_seats();
```

**Behavior verification:**

| Scenario | Trigger fires | is_active set to | Correct? |
|---|---|---|---|
| Insert seat into active link | trg_sync_active_on_seat_link | `true` (link status = 'active') | YES |
| Insert seat into cancelled link | trg_sync_active_on_seat_link | `false` | YES |
| Link status: active → cancelled | trg_sync_link_status_to_seats | `false` on all seat rows | YES |
| Link status: active → confirmed | trg_sync_link_status_to_seats | `false` on all seat rows | YES |
| Link status: active → expired | trg_sync_link_status_to_seats | `false` on all seat rows | YES |

### RLS Policies [PROPOSED — copy 040 pattern]

```sql
REVOKE ALL ON TABLE public.reservation_links FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.reservation_link_seats FROM anon, authenticated, PUBLIC;
ALTER TABLE public.reservation_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_link_seats ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated → deny-all. service_role bypasses RLS.

REVOKE EXECUTE ON FUNCTION public.trg_sync_seat_link_active() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_sync_link_status_to_seats() FROM PUBLIC, anon, authenticated;
```

### `updated_at` trigger [CONFIRMED — already exists]

```sql
-- Defined in migration 011_create_all.sql:12-18
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

```sql
CREATE TRIGGER reservation_links_updated_t
  BEFORE UPDATE ON reservation_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## Section 4: Seat Lock TTL Schema

### Problem

Today the TTL is a **global 5-minute** constant (`LOCK_TTL_SECONDS` default **300** in `backend/src/config/env.ts:33`), used with `locked_at` in:

- `backend/src/index.ts` cleanup
- `reservation.service.ts` `lockSeat` / `releaseExpiredLocks`
- `supabase/functions/release-expired-locks/index.ts`
- `hooks/useLockCountdown.ts` default `ttlSeconds = 300`
- `app/agency/reservations/new/page.tsx` (`NEXT_PUBLIC_LOCK_TTL_SECONDS || 300`)

**Product [CONFIRMED]:** wizard lock becomes **10 minutes (600s)**. This **is** a wizard behavior change. Do not claim “wizard unchanged.”

### Solution: Add `lock_expires_at` to seats [PROPOSED]

```sql
ALTER TABLE seats ADD COLUMN lock_expires_at TIMESTAMPTZ;
```

Backfill (align existing rows to the **new** 10-minute policy from original `locked_at`):

```sql
UPDATE seats
SET lock_expires_at = locked_at + INTERVAL '600 seconds'
WHERE status = 'locked' AND lock_expires_at IS NULL;
```

### Lock TTL values [CONFIRMED]

| Flow | TTL | Who writes it |
|---|---|---|
| Normal wizard `lockSeat` | **600s (10 min)** | App: `lock_expires_at = now + 600s`. Env default `LOCK_TTL_SECONDS=600`. Frontend default 600. **No `ttlOverride` on `lockSeat`.** |
| Link flow (after create/regenerate RPC) | **900s (15 min)** | RPC: `UPDATE lock_expires_at = NOW() + INTERVAL '900 seconds'` |

### Lock extension (not relock) [CONFIRMED]

When the agency creates or regenerates a link, existing locks are extended. Expiration is from `NOW()`, not accumulated:

```sql
UPDATE seats
SET lock_expires_at = NOW() + INTERVAL '900 seconds'
WHERE id = ANY(p_seat_ids)
  AND status = 'locked'
  AND lock_expires_at > NOW()
  AND locked_by IN (SELECT id FROM public.users WHERE agency_id = p_agency_id);
```

Create-link still requires the **creating user** to own the lock (`locked_by = p_created_by`) before this UPDATE. Confirm/regenerate/cancel use **agency membership** (see RPC 2/3/4).

The condition `lock_expires_at > NOW()` must remain on **extend**: you cannot extend a lock that already expired, even if cleanup has not yet executed.

No unlock/relock cycle. Atomic UPDATE. **`locked_at` is not updated** on extend — therefore cleanup **must not** use `locked_at + TTL` after cutover.

> **Example:**
>
> 19:00:00 → seat locked in wizard → `lock_expires_at = 19:10:00`
> 19:09:50 → agency creates reservation link
> New `lock_expires_at`: `19:09:50 + 15 minutes = 19:24:50`

### `lockSeat` modification [PROPOSED]

Always 600s. Link flow does not call `lockSeat` with 900.

```typescript
const expiresAt = new Date(Date.now() + 600 * 1000).toISOString();
await supabaseAdmin.from('seats').update({
  status: 'locked',
  locked_by: userId,
  locked_at: now,
  lock_expires_at: expiresAt,
}).eq('id', seatId).eq('status', 'available');
```

Also update `unlockSeat` / `unlockAllSeats` / `unlockAllSeatsForUser` **and** trip-cancel seat release (`superadmin.service.ts:1523`) to set `lock_expires_at: null`.

Env/tests to change together: `LOCK_TTL_SECONDS` default **600**, `NEXT_PUBLIC_LOCK_TTL_SECONDS` default **600**, `useLockCountdown` default **600**, all test stubs that hardcode `LOCK_TTL_SECONDS: 300`.

### Cleanup (3 mechanisms) [PROPOSED — B8]

**Single predicate after cutover:**

```sql
WHERE status = 'locked' AND lock_expires_at < NOW()
```

Clear `locked_by`, `locked_at`, **and** `lock_expires_at`.

| Mechanism | Location | After cutover |
|---|---|---|
| In-process setInterval | `backend/src/index.ts` | `lock_expires_at < NOW()` only. Stop using `locked_at` + `LOCK_TTL_SECONDS`. |
| Edge Function cron | `release-expired-locks/index.ts` | Same predicate. Stop reading `LOCK_TTL_SECONDS` for cutoff. |
| HTTP endpoint | `POST /agency/seats/release-expired` | Same predicate. |

**Deploy order (mandatory):**

1. Migration `068` (column + backfill 600s).
2. Deploy **API cleanup + Edge Function + lockSeat writes `lock_expires_at`** in the **same release window**. Do not leave a node or Edge Function on `locked_at + TTL`.
3. Only after all three cleanups use `lock_expires_at`, ship `069` + public/agency link routes.

Until step 2 is complete: **do not create production links.** Extending `lock_expires_at` while any cleanup still uses `locked_at` would release 15-minute link locks at wizard TTL.

### Frontend countdown [PROPOSED]

`useLockCountdown` reads **`lock_expires_at` from seat data** (server authority). Do not use `locked_at + hardcoded 15m`. Public page countdown uses **`expires_at` from GET**, not a client TTL.

---

## Section 5: Link Lifecycle

### Persistent states [CONFIRMED]

```
active    — link is live, accepts public saves
expired   — TTL elapsed or trip changed
cancelled — agency cancelled, seats released
confirmed — agency confirmed, reservation created
```

`PENDING` is not a state. Link creation is atomic — either succeeds (active) or rolls back.

### State diagram

```
                      ┌──────────────────────────┐
                      │  (creation TX)            │
                      │  extend locks 15m         │
                      │  create link rows         │
                      │  emit outbox              │
                      └────────────┬─────────────┘
                                   │ TX commits
                                   ▼
                             ┌───────────┐     15 min elapsed
                             │  ACTIVE   │ ──────────────────► EXPIRED
                             └──┬──┬──┬──┘
                                │  │  │
               ┌────────────────┘  │  └────────────────┐
               ▼                   ▼                   ▼
         ┌──────────┐       ┌──────────┐         ┌──────────┐
         │CONFIRMED │       │CANCELLED │         │ EXPIRED  │
         └──────────┘       └──────────┘         └──────────┘
               │                   │                   │
               ▼                   ▼                   ▼
          [done]            [seats released     [seats released
                             by agency]          by cleanup]
```

### Expiration is lazy [CONFIRMED]

No background job. Checked on: public GET, public POST save, agency confirm, agency cancel, agency regenerate, agency PATCH, agency GET list/detail.

### No link expiration notification scheduler [CONFIRMED — MVP]

Lazy expiration handles the functional requirement. No new infrastructure.

---

## Section 6: Reservation Creation Core [CONFIRMED — shared business logic]

### Problem with v1.1

v1.1 proposed that `confirm_reservation_from_link` manually implement INSERT reservations, INSERT passengers, generate QR, generate ticket, UPDATE seats, INSERT outbox. This duplicates the business core from `create_agency_reservation` and risks drift.

### Existing RPC audit [CONFIRMED — references: migration 066, reservation.service.ts:111-288]

`create_agency_reservation` (migration `066_create_agency_reservation_departed.sql`):

**What it does atomically (single PL/pgSQL transaction, no COMMIT/SAVEPOINT):**

1. Validates trip exists, `status = 'active'`, `departure_time > NOW()`
2. Validates agency assignment
3. Validates array lengths match
4. Locks seats with `SELECT ... FOR UPDATE` (consistent `ORDER BY id` to prevent deadlocks)
5. Accepts seats where `status = 'available'` OR `locked_by = p_created_by`
6. Generates `reservation_id`, `ticket_code`, `qr_code`
7. INSERT into `reservations` (status = 'confirmed')
8. INSERT into `reservation_passengers` (one per seat)
9. UPDATE seats to `status = 'reserved'` (does NOT clear `locked_by`/`locked_at`)
10. AFTER INSERT trigger emits `reservation.created` outbox event with dedup_key

**Critical behaviors:**

| Behavior | Detail | Reference |
|---|---|---|
| Accepts `available` seats | First disjunct in validation | `066:85` |
| Accepts `locked-by-self` seats | Second disjunct | `066:85` |
| Rejects `locked-by-other` seats | `ERR_SEAT_UNAVAILABLE` | `066:85` |
| Rejects `reserved`/`blocked`/`guide` | `ERR_SEAT_UNAVAILABLE` | `066:85` |
| Row-level lock via FOR UPDATE | Prevents concurrent double-booking | `066:76-93` |
| Deadlock prevention | `ORDER BY id` on seat lock | `066:80` |
| Returns `reservation_id`, `qr_code`, `ticket_code` | JSONB return | `066:144-148` |
| Outbox dedup | `'reservation.created:' \|\| NEW.id` with `ON CONFLICT DO NOTHING` | `056:42` |
| `SECURITY DEFINER`, service_role only | `REVOKE` from PUBLIC/anon/authenticated | `066:158-172` |

### Shared core strategy [PROPOSED]

**Approach:** Extract a `create_reservation_core` PL/pgSQL function that encapsulates the reservation creation logic (steps 6-10 above). Both `create_agency_reservation` (wizard) and `confirm_reservation_from_link` (link flow) call this shared core after their respective validation layers.

```
Wizard flow:
  create_agency_reservation
    → validates trip, agency, seats (available OR locked-by-self)
    → calls create_reservation_core(...)

Link flow:
  confirm_reservation_from_link
    → validates link (active, not expired, trip snapshot matches)
    → rejects departed trip (`ERR_TRIP_DEPARTED`) even if snapshot matches
    → validates seats (locked by any user of `p_agency_id` AND lock_expires_at > NOW())
    → reads `link_data` from DB and maps passengers by `seat_code` (`ORDER BY seats.seat_code`)
    → calls create_reservation_core(...)
```

This ensures:
- Single source of truth for QR generation, ticket code, passenger insertion, seat transition, outbox emission
- Wizard and link share identical reservation creation semantics
- No duplication of business logic

### `create_reservation_core` signature [PROPOSED]

```sql
CREATE OR REPLACE FUNCTION public.create_reservation_core(
  p_trip_id          UUID,
  p_agency_id        UUID,
  p_created_by       UUID,
  p_booker_name      TEXT,
  p_booker_document  TEXT,
  p_booker_phone     TEXT,
  p_seat_ids         UUID[],
  p_passenger_names  TEXT[],
  p_passenger_documents TEXT[],
  p_passenger_phones TEXT[]
)
RETURNS JSONB
```

**This function assumes seats are already validated and locked.** It does NOT validate seat ownership — that is the caller's responsibility. It performs:

1. Generate reservation_id, ticket_code, qr_code
2. INSERT reservations
3. INSERT reservation_passengers
4. UPDATE seats → `reserved` **and** clear `locked_by`, `locked_at`, `lock_expires_at` (improvement vs 066, which left lock columns set after reserve)
5. AFTER INSERT trigger emits outbox event

### `create_agency_reservation` refactored [PROPOSED]

```sql
CREATE OR REPLACE FUNCTION public.create_agency_reservation(
  p_trip_id UUID, p_agency_id UUID, p_created_by UUID,
  p_booker_name TEXT, p_booker_document TEXT, p_booker_phone TEXT,
  p_seat_ids UUID[], p_passenger_names TEXT[],
  p_passenger_documents TEXT[], p_passenger_phones TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- 1. Validate trip (active, not departed)
  -- 2. Validate agency assignment
  -- 3. Validate array lengths
  -- 4. Validate seats (available OR locked-by-self) with FOR UPDATE
  -- 5. Delegate to create_reservation_core(...)
  RETURN create_reservation_core(
    p_trip_id, p_agency_id, p_created_by,
    p_booker_name, p_booker_document, p_booker_phone,
    p_seat_ids, p_passenger_names, p_passenger_documents, p_passenger_phones
  );
END;
$$;
```

The validation logic stays in `create_agency_reservation`. The creation logic moves to `create_reservation_core`.

---

## Section 7: Link RPCs [PROPOSED]

All four RPCs are `SECURITY DEFINER`, service_role only.

### RPC 1: `create_reservation_link`

**Precondition:** Agency has already locked seats via `lockSeat()` (10m TTL). This RPC extends those locks to 15m and creates the link.

**Signature:**

```sql
CREATE OR REPLACE FUNCTION public.create_reservation_link(
  p_trip_id    UUID,
  p_agency_id  UUID,
  p_created_by UUID,
  p_token_hash TEXT,
  p_seat_ids   UUID[]
)
RETURNS JSONB
```

**Algorithm:**

1. Validate trip exists and `status = 'active'`. If not → `ERR_TRIP_NOT_FOUND`. If `departure_time <= NOW()` → `ERR_TRIP_DEPARTED` (same split as `066:46-52`).
2. Validate agency is assigned to trip. If not → `ERR_AGENCY_NOT_ASSIGNED`.
3. Validate `p_seat_ids` non-empty. If empty → `ERR_NO_SEATS`.
4. Lock seat rows with `SELECT ... FOR UPDATE ORDER BY id`.
5. **For each seat:** Require `status = 'locked' AND locked_by = p_created_by AND lock_expires_at > NOW()`. If any fails → `ERR_SEAT_INVALID_LOCK`. (No `available` seats. Create-link does **not** accept another agency user's lock.)
6. Pre-check uniqueness (defense-in-depth): `SELECT 1 FROM reservation_link_seats rls JOIN reservation_links rl ON rl.id = rls.link_id WHERE rls.seat_id = ANY(p_seat_ids) AND rl.status = 'active'`. If conflict → `ERR_SEAT_ACTIVE_LINK`.
7. Extend locks: `UPDATE seats SET lock_expires_at = NOW() + INTERVAL '900 seconds' WHERE id = ANY(p_seat_ids) AND status = 'locked' AND locked_by = p_created_by AND lock_expires_at > NOW()`.
8. Build trip_snapshot from current trip fields (status, departure_time, route_id, vehicle_type, capacity).
9. Generate link_id, INSERT into `reservation_links` (`status = 'active'`, `expires_at = NOW() + 900s`, trip_snapshot). `is_active` on seat rows is still FALSE until the next step's trigger.
10. INSERT seat associations into `reservation_link_seats` (`seat_id`, **and `seat_code` copied from `seats.seat_code`**). Trigger UPDATEs `is_active = TRUE`. **The unique violation happens on that UPDATE**, not on INSERT. Catch `unique_violation` → ROLLBACK → `ERR_SEAT_ACTIVE_LINK`. Do **not** use `INSERT ON CONFLICT (link_id, seat_id)`.
11. INSERT outbox event `reservation_link.created`.
12. Return `{ link_id, seat_codes, expires_at }`.

**If any step fails → ROLLBACK.** Seats remain in their previous lock state (still locked by the creating user at the pre-extend TTL unless step 7 committed — it does not, on rollback).

### RPC 2: `confirm_reservation_from_link`

**Signature:**

```sql
CREATE OR REPLACE FUNCTION public.confirm_reservation_from_link(
  p_link_id    UUID,
  p_agency_id  UUID,
  p_created_by UUID
)
RETURNS JSONB
```

**Note:** No passenger data parameters. The RPC reads `link_data` from the DB.

**Agency lock owner (used by confirm / regenerate / cancel — not create):**

```sql
locked_by IN (SELECT u.id FROM public.users u WHERE u.agency_id = p_agency_id)
```

Wizard RPC `create_agency_reservation` stays **locked-by-self** (`locked_by = p_created_by`). Create-link stays **locked-by-creating-user**. Confirm/regenerate accept any locker in the same agency so a second operator can confirm.

**Algorithm:**

1. Lock the link row: `SELECT * FROM reservation_links WHERE id = p_link_id FOR UPDATE`.
2. Validate: found, `agency_id = p_agency_id`, `status = 'active'`. If not found / wrong agency → `ERR_LINK_NOT_FOUND`. If `status IN ('expired','cancelled','confirmed')` → matching `ERR_LINK_*`. If `expires_at <= NOW()` → `UPDATE status = 'expired'`, `ERR_LINK_EXPIRED`.
3. Trip existence: `SELECT status, departure_time, route_id, vehicle_type, capacity FROM trips WHERE id = v_link.trip_id`. If not found → `UPDATE status = 'expired'`, `ERR_TRIP_MISSING`.
4. Trip change detection: compare those fields against `trip_snapshot`. If any differ → `UPDATE status = 'expired'`, `ERR_TRIP_CHANGED`.
5. **Departed (independent of snapshot):** if `departure_time <= NOW()` → `ERR_TRIP_DEPARTED`. Do **not** skip this because snapshot `departure_time` still matches. Shared core does **not** replace this check — confirm must run it in the validation layer.
6. Load seats with codes: `SELECT rls.seat_id, rls.seat_code FROM reservation_link_seats rls WHERE rls.link_id = p_link_id ORDER BY rls.seat_code`. If any `seat_id IS NULL` → `ERR_SEAT_INVALID_LOCK`.
7. Lock seat rows: `SELECT ... FROM seats WHERE id = ANY(v_seat_ids) FOR UPDATE ORDER BY id`.
8. **For each seat:** Require `status = 'locked' AND locked_by IN (users of p_agency_id) AND lock_expires_at > NOW()`. If any fails → `ERR_SEAT_INVALID_LOCK`. (No `available`, no other-agency lock, no expired locks. Same-agency colleague lock is valid.)
9. Read `link_data` from DB. Canonical mapping: for each `ORDER BY seat_code` row, take `passengers[]` with the same `seat_code`. Count mismatch or unknown code → `ERR_SEAT_NOT_IN_LINK`. Booker name + document non-empty; each passenger name + document non-empty → else `ERR_PASSENGER_INCOMPLETE`. Phone optional.
10. Delegate to `create_reservation_core(...)` with arrays in `ORDER BY seat_code` order.
11. Update link: `SET status = 'confirmed'`.
12. Emit outbox event `reservation_link.confirmed`.
13. Return `{ reservation_id, qr_code, ticket_code }`.

**Atomicity:** Steps 1-12 in a single transaction. If step 10 fails → entire TX rolls back. Link remains `active`. No partial state.

### RPC 3: `regenerate_reservation_link`

**Signature:**

```sql
CREATE OR REPLACE FUNCTION public.regenerate_reservation_link(
  p_old_link_id UUID,
  p_agency_id   UUID,
  p_created_by  UUID,
  p_token_hash  TEXT
)
RETURNS JSONB
```

**No `p_seat_ids`.** Seats come from the existing link.

**Same guards as confirm** (TTL, trip snapshot, trip missing, departed, agency-owned locks). Regenerating must **not** copy a stale snapshot into a new active link.

**Algorithm:**

1. Lock old link: `SELECT * FROM reservation_links WHERE id = p_old_link_id FOR UPDATE`.
2. Validate: found, `agency_id = p_agency_id`. Not found / wrong agency → `ERR_LINK_NOT_FOUND`. If persisted `status IN ('expired','cancelled','confirmed')` → matching `ERR_LINK_*` (HTTP 404/410 per table below). If `status = 'active'` and `expires_at <= NOW()` → lazy expire, `ERR_LINK_EXPIRED`.
3. Load current trip. Missing → lazy expire, `ERR_TRIP_MISSING`. Snapshot differs → lazy expire, `ERR_TRIP_CHANGED`. `departure_time <= NOW()` → `ERR_TRIP_DEPARTED` (do not create a new link).
4. Get seats: `SELECT rls.seat_id, rls.seat_code FROM reservation_link_seats rls WHERE rls.link_id = p_old_link_id ORDER BY rls.seat_code`. If any `seat_id IS NULL` → `ERR_SEAT_INVALID_LOCK`.
5. Lock seat rows `FOR UPDATE ORDER BY id`. Require each `status = 'locked' AND locked_by IN (users of p_agency_id) AND lock_expires_at > NOW()`. Else `ERR_SEAT_INVALID_LOCK`.
6. Preserve `link_data` from old link.
7. Invalidate old link: `UPDATE SET status = 'cancelled'`. (Trigger sets `is_active = FALSE` on old seat rows.)
8. Rebuild `trip_snapshot` from **current** trip (not the old JSON).
9. Extend locks: `UPDATE seats SET lock_expires_at = NOW() + INTERVAL '900 seconds' WHERE id = ANY(v_seat_ids) AND status = 'locked' AND locked_by IN (users of p_agency_id) AND lock_expires_at > NOW()`.
10. Create new link (fresh snapshot, same seats, inherited link_data, new token_hash, new expires_at = NOW()+900s).
11. Create seat associations for new link. (Trigger sets `is_active = TRUE`. Catch `unique_violation` → ROLLBACK.)
12. Emit outbox: `reservation_link.cancelled` for the old `link_id` and `reservation_link.created` for the new `link_id`. Audit action is `reservation_link.regenerated` (single row). Do not emit `passenger_data_saved`.
13. Return `{ link_id, seat_codes, expires_at, inherited_data }`.

**Seats are NEVER released or relocked.** Only `lock_expires_at` is updated.

### RPC 4: `cancel_reservation_link`

**Signature:**

```sql
CREATE OR REPLACE FUNCTION public.cancel_reservation_link(
  p_link_id   UUID,
  p_agency_id UUID
)
RETURNS JSONB
```

**Algorithm [CONFIRMED — B4, B13]:**

1. Lock link row: `SELECT * FROM reservation_links WHERE id = p_link_id FOR UPDATE`.
2. Not found or `agency_id != p_agency_id` → `ERR_LINK_NOT_FOUND` (HTTP 404).
3. If persisted `status IN ('expired', 'cancelled', 'confirmed')` → `ERR_LINK_NOT_FOUND` (HTTP 404). Do **not** re-cancel. Do **not** release seats for a confirmed link.
4. If persisted `status = 'active'` → **cancel is allowed even when `expires_at` has already passed** (lazy expiry not yet materialized). This is the B13 rule. Do not return 404 solely because TTL elapsed.
5. Release leftover locks **owned by this agency only**:

```sql
UPDATE seats
SET status = 'available',
    locked_by = NULL,
    locked_at = NULL,
    lock_expires_at = NULL
WHERE id IN (SELECT seat_id FROM reservation_link_seats WHERE link_id = p_link_id)
  AND status = 'locked'
  AND locked_by IN (SELECT u.id FROM public.users u WHERE u.agency_id = p_agency_id);
```

Never touch `reserved` / `blocked` / `available`. Never release a lock owned by another agency. Expired leftover locks **of this agency** may be released (cleanup-equivalent). If a seat is still locked by another actor, leave it.

6. Mark cancelled: `UPDATE reservation_links SET status = 'cancelled'`. (Trigger sets `is_active = FALSE`.)
7. Emit outbox event `reservation_link.cancelled`.
8. Return `{ success: true }`.

---

## Section 8: Agency API Endpoints

All under `/agency/reservations/links`, authenticated via `auth` + `authorize('agency')` + `tenant`.

### POST `/agency/reservations/links`

**Create a reservation link.** Calls `create_reservation_link` RPC.

Request: `{ trip_id, seat_ids }`

Response: `{ link_id, token, url, expires_at, seats }`

Token returned **only once**. Never again.

### POST `/agency/reservations/links/:id/confirm`

**Confirm a link.** Calls `confirm_reservation_from_link` RPC.

Request body: **empty** (no passenger data — read from DB).

Response: `{ reservation_id, qr_code, ticket_code }`

### POST `/agency/reservations/links/:id/cancel`

**Cancel a link.** Calls `cancel_reservation_link` RPC.

Response: `{ success: true }`

### POST `/agency/reservations/links/:id/regenerate`

**Regenerate link.** Calls `regenerate_reservation_link` RPC.

Request body: **empty** (seats come from existing link).

Response: `{ link_id, token, url, expires_at, seats, inherited_data }`

### PATCH `/agency/reservations/links/:id/data`

**Edit link passenger data (agency correction).** [NEW ENDPOINT]

Request:

```json
{
  "link_data": {
    "booker_name": "Juan Pérez",
    "booker_document": "12345678",
    "booker_phone": "+59899123456",
    "passengers": [
      { "seat_code": "A1", "name": "Juan Pérez", "document": "12345678", "phone": "" }
    ]
  }
}
```

Behavior:
1. Call `patch_reservation_link_data` RPC (FOR UPDATE + same lazy expiry / trip checks as confirm). Do **not** issue a JS `SELECT … FOR UPDATE`.
2. If persisted status is not `active` after that → 404/410 per error table.
3. Load authorized `seat_code`s from `reservation_link_seats.seat_code`. Payload must match that set exactly. Extra/unknown → `ERR_SEAT_NOT_IN_LINK`.
4. Replace `link_data` entirely. Persist `seat_code` only — strip any client-sent `seat_id`.
5. **Do not emit** `passenger_data_saved` (B10).
6. Return 200 with updated `link_data`.

This endpoint allows the agency to correct passenger data before confirmation. After this call, `confirm_reservation_from_link` reads the corrected data from DB.

### GET `/agency/reservations/links`

**List links.** Query params: `trip_id?`, `status?`, `page?`, `limit?`

Lazy-materialize TTL expiry in the same request:

```sql
UPDATE reservation_links
SET status = 'expired'
WHERE agency_id = :agency
  AND status = 'active'
  AND expires_at <= NOW();
```

Then list. Also compute `effective_status`: if joined trip is missing or snapshot differs, treat as `expired` and persist that UPDATE for those rows (same trip-change SQL as confirm). Response includes per-link: id, trip info, `status` (post-materialize), seats (`seat_code` only), passenger_data_complete count, expires_at.

### GET `/agency/reservations/links/:id`

**Get link details.** Same lazy materialize as list/detail path (TTL + trip missing + trip changed). Shows seats (`seat_code`), `link_data`, completion status. Never returns raw token.

### Agency ERR_* → HTTP [PROPOSED — complete table]

Reuse existing `reservation.service.ts` mapping where the code already exists. New codes follow the same families.

| ERR_* | HTTP | Existing analog |
|---|---|---|
| `ERR_LINK_NOT_FOUND` | 404 | `NotFoundError` |
| `ERR_LINK_EXPIRED` | 410 | Gone |
| `ERR_LINK_CONFIRMED` | 410 | Gone |
| `ERR_LINK_CANCELLED` | 410 | Gone |
| `ERR_TRIP_NOT_FOUND` | 404 | existing |
| `ERR_TRIP_MISSING` | 410 | Gone (link invalidated) |
| `ERR_TRIP_CHANGED` | 410 | Gone |
| `ERR_TRIP_DEPARTED` | 409 | existing `ConflictError` |
| `ERR_AGENCY_NOT_ASSIGNED` | 403 | existing |
| `ERR_NO_SEATS` | 400 | existing |
| `ERR_SEAT_INVALID_LOCK` | 409 | Conflict |
| `ERR_SEAT_ACTIVE_LINK` | 409 | Conflict |
| `ERR_SEAT_NOT_IN_LINK` | 400 | Validation |
| `ERR_PASSENGER_INCOMPLETE` | 400 | Validation |
| `ERR_PASSENGER_MISMATCH` | 400 | existing |

Controller maps RPC exception prefix `ERR_*` the same way `createAgencyReservation` does today.

---

## Section 9: Public API Endpoints

All under `/api/public/reservation-links`. **No authentication.** Rate-limited.

Supabase JS cannot `SELECT … FOR UPDATE`. Public GET and public save **must** be `SECURITY DEFINER` RPCs (`service_role` only, `REVOKE` from anon/authenticated). The Express handler hashes the token, calls the RPC with `p_token_hash`, and maps the RPC `error_code` to HTTP. Raw token never enters SQL.

### RPC: `public_get_reservation_link(p_token_hash TEXT)`

Implements GET steps 3–13 in one transaction (FOR UPDATE + lazy expire + DTO fields). Returns JSON `{ ok, error_code, body }`.

### RPC: `public_save_reservation_link(p_token_hash TEXT, p_link_data JSONB)`

Implements POST save in one transaction (FOR UPDATE + same lazy checks + exact `seat_code` set + replace + first-save outbox). Returns JSON `{ ok, error_code, body }`.

Also create `patch_reservation_link_data` (agency PATCH, FOR UPDATE).

### GET `/api/public/reservation-links/:token`

**These steps run inside `public_get_reservation_link`.** Express only validates format, hashes, calls the RPC, maps `error_code` → HTTP.

1. Validate token format: `/^[a-f0-9]{64}$/`. Invalid format → 404 `LINK_NOT_FOUND` (do not leak "malformed").
2. `token_hash = SHA-256(token)`.
3. `SELECT * FROM reservation_links WHERE token_hash = :hash FOR UPDATE`.
4. Not found → 404 `{ "error": { "code": "LINK_NOT_FOUND", "message": "..." } }`.
5. If `status = 'confirmed'` → 410 `LINK_CONFIRMED`.
6. If `status = 'cancelled'` → 410 `LINK_CANCELLED`.
7. If `status = 'expired'` → 410 `LINK_EXPIRED`.
8. If `status = 'active'` and `expires_at <= NOW()` → `SET status = 'expired'`, return 410 `LINK_EXPIRED`.
9. Trip missing: `SELECT ... FROM trips WHERE id = trip_id`. Not found → lazy expire, 410 `TRIP_MISSING`.
10. Trip changed: compare current trip fields against `trip_snapshot`. If any differ → lazy expire, 410 `TRIP_CHANGED`.
11. Fetch seats from `reservation_link_seats.seat_code` `ORDER BY seat_code` (strings only; do not JOIN `seats` for the public DTO).
12. Fetch agency name + logo from `agencies` JOIN `agency_settings` (public Storage URL).
13. Return minimal response. `link_data.passengers` keyed by `seat_code` only.

Response:

```json
{
  "trip": { "destination": "Punta del Este", "departure_time": "2025-01-15T08:00:00Z" },
  "agency": { "name": "Agencia Central", "logo_url": "https://...supabase.co/storage/..." },
  "seats": ["A1", "A2"],
  "link_data": {
    "booker_name": "",
    "booker_document": "",
    "booker_phone": "",
    "passengers": [
      { "seat_code": "A1", "name": "", "document": "", "phone": "" }
    ]
  },
  "expires_at": "2025-01-01T12:15:00Z"
}
```

**NOT exposed:** `link_id`, origin, `trip_id`, `route_id`, `agency_id`, seat UUIDs, `vehicle_type`, price, internal metadata, `created_by`. The token in the URL is the only link identifier the public page needs.

### Public error body [CONFIRMED — B11]

Always JSON `{ "error": { "code": "<CODE>", "message": "<human>" } }`.

| `error.code` | HTTP | When | Public UI copy |
|---|---|---|---|
| `LINK_NOT_FOUND` | 404 | Unknown token / invalid format | "Este enlace no existe." |
| `LINK_EXPIRED` | 410 | TTL elapsed or already `expired` | "Este enlace ha expirado." |
| `TRIP_CHANGED` | 410 | Snapshot mismatch | "Este viaje fue modificado. Solicitá un nuevo enlace." |
| `TRIP_MISSING` | 410 | Trip row missing | "Este viaje ya no está disponible." |
| `LINK_CONFIRMED` | 410 | Already confirmed | "Esta reserva ya fue confirmada." |
| `LINK_CANCELLED` | 410 | Agency cancelled | "Este enlace fue cancelado." |

Do **not** collapse these into a single 410 without `code`. The public page branches on `error.code`.

### POST `/api/public/reservation-links/:token/save`

**Save passenger data (full-state replacement).**

Request:

```json
{
  "booker_name": "Juan",
  "booker_document": "123",
  "booker_phone": "",
  "passengers": [
    { "seat_code": "A1", "name": "Juan", "document": "123", "phone": "" },
    { "seat_code": "A2", "name": "", "document": "", "phone": "" }
  ]
}
```

Behavior:
1. Same token + lazy expiry / trip checks as GET, with `SELECT ... FOR UPDATE` on the link row.
2. Derive authorized `seat_code`s from `reservation_link_seats.seat_code`. Never accept `seat_id` from the client. Strip any `seat_id` before persist.
3. Payload `passengers[].seat_code` set must match authorized set exactly (same count, every code). Extra/unknown/duplicate → 400 `ERR_SEAT_NOT_IN_LINK` mapped as validation (do not 410).
4. **Partial save allowed:** No validation that name/document are non-empty.
5. Replace `link_data` entirely with the sanitized payload (`seat_code` only).
6. **Outbox `passenger_data_saved` [B10]:** emit **only on the first successful public save** for this `link_id`. Implementation: INSERT outbox with dedup_key `'reservation_link.passenger_data_saved:' || link_id` and `ON CONFLICT DO NOTHING` (same pattern as `056`). Subsequent public saves do not create a second event. Agency PATCH never inserts this event.
7. Return 200 with updated `link_data` (still `seat_code` only).

The backend uses `reservation_link_seats.seat_code` as the source of truth for which seat codes exist.

---

## Section 10: Cleanup & Expiration

### Link expiration (lazy) [CONFIRMED]

| Surface | Check |
|---|---|
| Public GET | lazy expire / trip change / missing → 410 with specific `error.code` |
| Public POST save | same as GET (FOR UPDATE) |
| Agency confirm | TTL / trip change / missing / departed → matching ERR_* |
| Agency regenerate | same guards as confirm |
| Agency PATCH | same lazy checks, then replace data |
| Agency cancel | persisted expired/cancelled/confirmed → 404; `status='active'` (even past TTL) → cancel allowed |
| Agency list/detail | materialize TTL + trip-change into `status` / `effective_status` |

### Seat lock cleanup (3 mechanisms) [EXISTING — updated to use lock_expires_at]

| Mechanism | Frequency | Durable? |
|---|---|---|
| In-process `setInterval` (`index.ts:37-62`) | Every 60s | No |
| Edge Function cron (`release-expired-locks/`) | Every 5 min | Yes |
| HTTP endpoint (`POST /agency/seats/release-expired`) | On demand | N/A |

All three: `WHERE status = 'locked' AND lock_expires_at < NOW()`.

---

## Section 11: Security

### Token security [CONFIRMED]

32 bytes entropy (`crypto.randomBytes(32).toString('hex')`, same as `backend/src/utils/token.ts`). SHA-256 hashed. Raw token never stored.

**URL sanitization [CONFIRMED — B6]:** Today Sentry `beforeSend` (`backend/src/observability/sentry.ts:92-101`) deletes `request.data`, cookies, and auth headers. It does **not** redact `request.url`. Public routes put the raw token in the path (`/api/public/reservation-links/:token`). Agency create responses include the token once.

Required beforeSend (and any logger that prints URLs):

1. Redact path segments matching `/[a-f0-9]{64}/` when the path contains `reservation-links`.
2. Redact query `token=` values.
3. Never put the raw token in error `message`, Sentry extras, or `console.*`.

**Automated tests required** (not "code review"): given a mock event whose `request.url` contains a 64-hex token (path and `?token=`), `beforeSend` must return a URL without that hex. Same for any request-logging helper used by public routes.

### Rate limiting [PROPOSED]

```typescript
const linkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many requests' } },
});
```

Applied to public GET and POST.

### RLS [PROPOSED]

Copy `040_harden_password_resets.sql`: `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL` from `anon`, `authenticated`, `PUBLIC`. Trigger functions: `REVOKE EXECUTE` from `PUBLIC`/`anon`/`authenticated`. All access via `service_role`.

### Seat authorization on public endpoints [CONFIRMED]

Server derives authorized `seat_code`s from `reservation_link_seats.seat_code`. Client never sends seat UUIDs. Unknown codes are rejected.

---

## Section 12: Concurrency

### Matrix [CONFIRMED]

| Scenario | Outcome | Mechanism |
|---|---|---|
| Same link, two saves | last-write-wins | No conflict — full replacement |
| Cancel + save | cancel wins | Cancel RPC locks row; save sees `status != 'active'` |
| Confirm + save | confirm wins | Confirm RPC locks row; save sees `status != 'active'` |
| Regenerate + save | regenerate wins | Old link invalidated; save sees `status = 'cancelled'` |
| Same seat, two links | DB rejects second | Partial unique index on `is_active` |
| Disjoint seats | both succeed | No conflict |
| Expired lock + confirm | confirm rejected | `lock_expires_at > NOW()` check fails |
| Expired lock + create link | create rejected | `lock_expires_at > NOW()` check fails |
| Two concurrent confirms | second rejected | `FOR UPDATE` on link row; second sees `status = 'confirmed'` |

---

## Section 13: Notifications

### Outbox events [PROPOSED]

Insert into `outbox_events` with the same envelope as `056` / `emit_trip_event` (`057:40`): `event_type`, `event_version=1`, `aggregate_type='reservation_link'`, `aggregate_id=link_id`, `tenant_id=agency_id`, PII-free payload, `status='pending'`, `dedup_key`, `ON CONFLICT DO NOTHING`.

Provide `emit_reservation_link_event(...)` SECURITY DEFINER helper (same posture as `emit_trip_event`). RPCs call the helper; they do not ad-hoc INSERT with a different shape.

| Event | Payload | Dedup key |
|---|---|---|
| `reservation_link.created.v1` | `{link_id, trip_id, agency_id}` | `'reservation_link.created:' \|\| link_id` |
| `reservation_link.passenger_data_saved.v1` | `{link_id, trip_id, agency_id}` | `'reservation_link.passenger_data_saved:' \|\| link_id` |
| `reservation_link.confirmed.v1` | `{link_id, trip_id, agency_id, reservation_id}` | `'reservation_link.confirmed:' \|\| link_id` |
| `reservation_link.cancelled.v1` | `{link_id, trip_id, agency_id}` | `'reservation_link.cancelled:' \|\| link_id` |

`event_type` column values are without `.v1` suffix, matching `reservation.created` (`056:29`): `reservation_link.created`, `reservation_link.passenger_data_saved`, `reservation_link.confirmed`, `reservation_link.cancelled`. Version lives in `event_version`.

### Worker consume path [REQUIRED — existing runner claims `eventType: null`]

`backend/src/workers/runner.ts` claims **all** event types. Missing handlers fail the row (`relay.ts`: "No handler for …").

Required application work:

1. Event modules under `backend/src/events/` (parse + type constants), same style as `reservation-created.v1.ts`.
2. Register handlers in `backend/src/workers/handlers/index.ts` `buildDefaultHandlers()`.
3. `passenger_data_saved`: NotificationFanout → agency in-app row. `action_url`: `/agency/reservations/links/:id` (agency only; no passenger names).
4. `created` / `confirmed` / `cancelled`: complete successfully even if they only write audit metadata / no extra in-app row. Do **not** leave them unhandled.
5. Extend `notifications_type_check` (live list is `063`: `trip_created` … `occupancy_alert`) with `reservation_link_passenger_data`.
6. Extend `notifications.entity_type` CHECK (`029`: `trip`, `reservation`, `passenger`) with `reservation_link`.
7. Add icon fallback in `NOTIFICATION_ICONS` (unknown types already fall back to `trip_created` in `NotificationItem.tsx`; still add an explicit key).

### In-app notifications [PROPOSED]

| Recipient | Trigger | Copy |
|---|---|---|
| Agency user | **First** successful public save only | "Un pasajero cargó datos para el viaje a {destination}" |

Subsequent public saves and agency PATCH do **not** notify again. No email/SMS for links (out of scope).

---

## Section 14: Audit Logging [PROPOSED]

`audit_log` CHECKs (`065_audit_log.sql`) **will reject** new actions/entity types until extended. This is a required write path, not optional logging.

**Migration must:**

```sql
ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check CHECK (
  action IN (
    -- existing 065 list unchanged --
    'trip.created', 'trip.updated', 'trip.cancelled',
    'reservation.created', 'reservation.cancelled',
    'boarding.board', 'boarding.unboard',
    'agency_settings.updated', 'notification_preferences.updated',
    -- F5-004 --
    'reservation_link.created',
    'reservation_link.cancelled',
    'reservation_link.confirmed',
    'reservation_link.regenerated',
    'reservation_link.passenger_data_saved',
    'reservation_link.expired'
  )
);

ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_entity_type_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_entity_type_check CHECK (
  entity_type IN (
    'trip', 'reservation', 'reservation_passenger',
    'agency_settings', 'notification_preferences',
    'reservation_link'
  )
);
```

Also extend `AUDIT_ACTIONS` / `AUDIT_ENTITY_TYPES` in `backend/src/types/audit.ts` (read API filters). Writer is `audit_append` (065); call it from the same RPC transaction. `before`/`after` hold seat_codes and status only — **no raw token, no PII**.

| Action | Actor | Details |
|---|---|---|
| `reservation_link.created` | agency | agency_id, trip_id, seat_codes, created_by |
| `reservation_link.cancelled` | agency | agency_id, link_id |
| `reservation_link.confirmed` | agency | agency_id, link_id, reservation_id |
| `reservation_link.regenerated` | agency | old_link_id, new_link_id |
| `reservation_link.passenger_data_saved` | system | link_id only (first public save) |
| `reservation_link.expired` | system | link_id (lazy materialize) |

---

## Section 15: Frontend — Public Page [PROPOSED]

### Route

`/reservations/link?token=<raw-token>`

Today `middleware.ts` only redirects unauthenticated users on `protectedPaths` (`/admin`, `/agency`). `publicPaths` is **declared and unused**. `/reservations/link` is already reachable without login.

**Still add** `/reservations/link` to `publicPaths` so a future middleware that starts consulting that array does not lock the page behind auth. Do not claim the current file redirects this route.

### Layout

Two-column matching auth pages:

**Left:** Nómadas Tour logo (from `/public/brand/`), agency logo (public Storage URL), agency name, destination, date/time, seat **codes** as pills.

**Right:** Countdown (from GET `expires_at`), booker form, per-passenger forms keyed by `seat_code`, "Guardar" button (full-state replacement), progress indicator "1/3 completados", success state.

**Do not use `BusLayout`.** The public page is not a seat map. No vehicle internals, no seat UUIDs, no interactive seats.

### Expiration handling (branch on `error.code`)

- `LINK_EXPIRED` → "Este enlace ha expirado."
- `TRIP_CHANGED` → "Este viaje fue modificado. Solicitá un nuevo enlace."
- `TRIP_MISSING` → "Este viaje ya no está disponible."
- `LINK_CONFIRMED` → "Esta reserva ya fue confirmada."
- `LINK_CANCELLED` → "Este enlace fue cancelado."
- `LINK_NOT_FOUND` → "Este enlace no existe."

### Design compliance

All AGENTS.md rules: Montserrat headings, Poppins body, `--color-brand-surface`, `--color-brand-cyan` CTA, visible labels, pill badges, empty states with CTA.

---

## Section 16: Frontend — Agency Link Management [PROPOSED]

### Card-based list

```
┌─────────────────────────────────────────────┐
│ Enlace activo — Punta del Este              │
│ Asientos: A1, A2                             │
│ Pasajeros: 1/2 completaron datos             │
│ Expira en: 12:34                             │
│ [Copiar enlace] [Corregir datos] [Cancelar] │
└─────────────────────────────────────────────┘
```

### Actions

- **Copiar enlace:** Copy URL. Toast "Enlace copiado".
- **Corregir datos:** Opens editable form. Saves via `PATCH /agency/reservations/links/:id/data`.
- **Cancelar:** Confirmation modal. Calls cancel endpoint.
- **Confirmar reserva:** Enabled when all passengers complete. Calls confirm endpoint (empty body — reads from DB). Redirects to ticket.

---

## Section 17: Integration with Existing Wizard [CONFIRMED]

**The wizard is not unchanged.** Product: wizard lock TTL moves from **5 minutes (300s)** to **10 minutes (600s)**. `lockSeat` writes `lock_expires_at`. Countdown reads `lock_expires_at`. Cleanup uses `lock_expires_at`. Env defaults `LOCK_TTL_SECONDS` and `NEXT_PUBLIC_LOCK_TTL_SECONDS` become 600.

Link creation is a **separate flow** after seats are already locked in the wizard (or trip-detail lock path):

```
[Crear reserva]  ← existing wizard confirm (locks now 10m)
[Crear enlace]   ← new link flow (extends those locks to 15m)
```

Wizard `create_agency_reservation` validation stays **available OR locked-by-self**. Link confirm uses **agency-owned lock**. Do not mix those predicates.

---

## Section 18: Trip Change Detection

### Existing wizard behavior [NEEDS VALIDATION]

When superadmin modifies a trip while wizard is open:

1. **Trip cancelled/completed:** Supabase realtime fires. Frontend redirects with error toast. (`useSeatLocking.ts:332-393`, `subscriptions.ts:118-155`)
2. **Trip fields changed:** Realtime fires. Toast + refetch + seat map rebuild. (`useSeatLocking.ts:332-393`)
3. **Locks NOT invalidated by trip edits.** `updateTrip` does not release locks. (`superadmin.service.ts:1057-1370`)

### Link detection: trip_snapshot [CONFIRMED]

The `trip_snapshot` column stores trip state at link creation. On every public access and on confirmation, current trip is compared.

**Fields tracked (exhaustive for v1):**

| Field | Why relevant |
|---|---|
| `status` | Trip cancelled/completed → link invalid |
| `departure_time` | Departure changed → time context stale |
| `route_id` | Route changed → origin/destination may differ |
| `vehicle_type` | Vehicle changed → seat layout may differ |
| `capacity` | Capacity changed → seats may have been removed |

**Missing trip:** If `SELECT 1 FROM trips WHERE id = trip_id` returns no rows → link invalid.

**Comparison logic (in RPC and public GET):**

[CONFIRMED] Relevant trip change = ANY difference in the five tracked fields (`status`, `departure_time`, `route_id`, `vehicle_type`, `capacity`). No second variant exists.

**Trip exists + unchanged:**

```sql
IF EXISTS (
  SELECT 1
  FROM trips t
  WHERE t.id = v_link.trip_id
    AND (
      t.status IS DISTINCT FROM (v_link.trip_snapshot->>'status')
      OR t.departure_time IS DISTINCT FROM (v_link.trip_snapshot->>'departure_time')::timestamptz
      OR t.route_id IS DISTINCT FROM (v_link.trip_snapshot->>'route_id')::uuid
      OR t.vehicle_type IS DISTINCT FROM (v_link.trip_snapshot->>'vehicle_type')
      OR t.capacity IS DISTINCT FROM (v_link.trip_snapshot->>'capacity')::integer
    )
) THEN
  -- Trip changed → invalidate link
END IF;
```

**Trip missing (deleted):**

```sql
IF NOT EXISTS (
  SELECT 1
  FROM trips
  WHERE id = v_link.trip_id
) THEN
  -- Trip missing → invalidate link
END IF;
```

Two separate checks. First detects changes. Second detects deletion. No second comparison variant.

---

## Section 19: Public Data Exposure [CONFIRMED]

### Exposed

agency logo, agency name, destination, departure date/time, seat codes, `link_data` (`seat_code` keys only), expires_at.

### NOT exposed

origin, `trip_id`, `route_id`, `agency_id`, `link_id`, seat UUIDs, `vehicle_type`, price, internal metadata, `created_by`, raw token in JSON.

---

## Section 20: Backup & Restore [CONFIRMED]

Post-restore cleanup documented in `RECOVERY-CHECKLIST.md`:

```sql
-- 1. Expire every still-active link (do not delete historical rows).
UPDATE reservation_links
SET status = 'expired'
WHERE status = 'active';

-- 2. Release leftover locks for those links if the locker still belongs
--    to the link's agency. Never touch reserved / confirmed seats.
UPDATE seats s
SET status = 'available',
    locked_by = NULL,
    locked_at = NULL,
    lock_expires_at = NULL
FROM reservation_link_seats rls
JOIN reservation_links rl ON rl.id = rls.link_id
JOIN public.users u ON u.id = s.locked_by AND u.agency_id = rl.agency_id
WHERE rls.seat_id = s.id
  AND rl.status = 'expired'
  AND s.status = 'locked';
```

Confirmed reservations and `status = 'reserved'` seats are **untouched**. Historical link rows (`expired`, `cancelled`, `confirmed`) stay for audit.

Because `trip_id` is `ON DELETE RESTRICT`, a restore that is missing `trips` rows while `reservation_links` exist will fail FK checks on replay — restore trips first, or the split-brain case is handled at read time as `TRIP_MISSING` (410), not CASCADE delete.

---

## Section 21: Testing Strategy

### Lock tests

| Test | Expected |
|---|---|
| Normal wizard lock | `lock_expires_at = now + 600s` |
| Link flow extends lock | 600s → 900s atomically |
| Failed create-link TX | Seats unchanged, original lock intact |
| Lock cleanup | Seats with `lock_expires_at < NOW()` released |

### Create link tests

| Test | Expected |
|---|---|
| Create link with valid existing lock | Success |
| Create link with `available` seat | `ERR_SEAT_INVALID_LOCK` |
| Create link with expired lock | `ERR_SEAT_INVALID_LOCK` |
| Create link with lock by another agency | `ERR_SEAT_INVALID_LOCK` |
| Create link with duplicate active seat | `ERR_SEAT_ACTIVE_LINK` |
| Create link with disjoint seats (second link) | Success |

### Regenerate tests

| Test | Expected |
|---|---|
| Regenerate same seats | New link, inherited data, old invalidated |
| Regenerate preserves link_data | Draft data carried forward |
| Regenerate does not unlock/relock | Seats stay locked, only lock_expires_at updated |
| Regenerate with inactive old link | Rejected |
| Regenerate after TTL | `ERR_LINK_EXPIRED`; no new active link |
| Regenerate after trip changed | `ERR_TRIP_CHANGED`; does not copy stale snapshot |
| Regenerate after departure | `ERR_TRIP_DEPARTED` |
| Regenerate with colleague's lock (same agency) | Success |

### Confirmation tests

| Test | Expected |
|---|---|
| Confirm with valid locked seats | Success, reservation created |
| Confirm with `available` seat | `ERR_SEAT_INVALID_LOCK` |
| Confirm with expired lock | `ERR_SEAT_INVALID_LOCK` |
| Confirm with another user's lock in the **same** agency | Success (B3) |
| Confirm with another **agency's** lock | `ERR_SEAT_INVALID_LOCK` |
| Confirm with incomplete passengers | `ERR_PASSENGER_INCOMPLETE` |
| Confirm maps by `seat_code` `ORDER BY seat_code` | Arrays to core match that order |
| Confirm reads link_data from DB | Correct data used; body ignored |
| Confirm after departure with unchanged snapshot | `ERR_TRIP_DEPARTED` (B5) |
| Double confirm | Second rejected (`status = 'confirmed'`) |
| Confirm expired link | Rejected (`ERR_LINK_EXPIRED` / 410) |
| Confirm stale link (trip changed) | `ERR_TRIP_CHANGED` |
| Confirm with missing trip | `ERR_TRIP_MISSING` |

### Progressive save tests

| Test | Expected |
|---|---|
| Full-state replacement | link_data overwritten entirely |
| Partial save (empty fields) | Allowed, no validation error |
| Save with `seat_code` set matching link | 200 |
| Save with extra/unknown `seat_code` | 400 `ERR_SEAT_NOT_IN_LINK` |
| Save never persists `seat_id` | Stored JSON has `seat_code` only |
| First public save emits outbox once | One `passenger_data_saved` row |
| Second public save | No second outbox row (`ON CONFLICT DO NOTHING`) |
| Agency PATCH | No `passenger_data_saved` outbox |
| Reload after save | Previous data persists |
| Overwrite previous values | Last write wins |

### Trip change tests

| Test | Expected |
|---|---|
| Trip status changed | Public GET returns 410 |
| Trip departure changed | Public GET returns 410 |
| Trip route changed | Public GET returns 410 |
| Trip vehicle changed | Public GET returns 410 |
| Trip capacity changed | Public GET returns 410 |
| Trip deleted / missing | Public GET returns 410 `TRIP_MISSING` |
| Agency confirms stale link | Rejected (`ERR_TRIP_CHANGED`) |

### Cancel tests

| Test | Expected |
|---|---|
| Cancel `status=active` after TTL (lazy, not materialized) | Success; link `cancelled` (B13) |
| Cancel already `expired`/`cancelled`/`confirmed` | 404 |
| Cancel with leftover lock owned by this agency | Seat released |
| Cancel while seat locked by **another agency** | Link cancelled; that seat **not** released (B4) |
| Cancel never updates `reserved` seats | Seat stays reserved |

### Token / Sentry tests [B6 — automated, not review]

| Test | Expected |
|---|---|
| `beforeSend` with path `/api/public/reservation-links/<64hex>` | URL has no raw hex token |
| `beforeSend` with `?token=<64hex>` | Query redacted |
| Public 410/404 bodies | No token echo |

### Wizard TTL tests

| Test | Expected |
|---|---|
| `lockSeat` writes 600s | `lock_expires_at ≈ now+600` |
| `LOCK_TTL_SECONDS` default | 600 |
| Frontend countdown default | 600 |
| Cleanup predicate | `lock_expires_at < NOW()` only; no `locked_at + TTL` |

### is_active trigger tests

| Test | Expected |
|---|---|
| Insert seat into active link | `is_active = TRUE` |
| Insert seat into cancelled link | `is_active = FALSE` |
| Link status: active → cancelled | All seat rows `is_active = FALSE` |
| Link status: active → confirmed | All seat rows `is_active = FALSE` |
| Concurrent create-link (same seat) | One succeeds, one rejected by unique index |
| Rollback after trigger/index violation | No orphaned `is_active = TRUE` rows |

### Concurrency tests

| Test | Expected |
|---|---|
| Two users save same link | Last-write-wins |
| Cancel + save race | Cancel wins |
| Confirm + save race | Confirm wins |
| Regenerate + save race | Regenerate wins |
| Two concurrent confirms | Second rejected |

---

## Section 22: Migration Plan [PROPOSED]

### Migration `067_reservation_links.sql`

1. Create `reservation_links` table (`trip_id ON DELETE RESTRICT`).
2. Create `reservation_link_seats` table (`seat_id ON DELETE SET NULL`, denormalized `seat_code`).
3. Create `is_active` sync triggers (2 functions, 2 triggers). `REVOKE EXECUTE` from PUBLIC/anon/authenticated.
4. Create partial unique index on `is_active`.
5. Enable RLS + `REVOKE ALL` from anon/authenticated/PUBLIC (040 pattern).
6. Create `reservation_links_updated_t` trigger.

### Migration `068_seat_lock_expires_at.sql`

1. Add `lock_expires_at` column to `seats`.
2. Backfill from `locked_at + INTERVAL '600 seconds'` for currently locked seats (new wizard TTL, not 300).

### Migration `069_reservation_link_rpcs.sql`

1. Create `create_reservation_core` (shared reservation creation logic).
2. Refactor `create_agency_reservation` to delegate to `create_reservation_core`.
3. Create `create_reservation_link` RPC.
4. Create `confirm_reservation_from_link` RPC.
5. Create `regenerate_reservation_link` RPC.
6. Create `cancel_reservation_link` RPC.
7. Create `public_get_reservation_link`, `public_save_reservation_link`, and `patch_reservation_link_data` RPCs.
8. Create `emit_reservation_link_event` helper.
9. Grant EXECUTE to `service_role` only. `REVOKE EXECUTE` from `PUBLIC`/`anon`/`authenticated` on every new function including `create_reservation_core`.
10. Patch current `update_trip` (live body is `065_audit_log.sql`) and the service-layer capacity shrink: `is_active` link seats count as in-use (`ERR_SEATS_IN_USE`).
11. Patch every SQL that currently `SET locked_by = NULL, locked_at = NULL` to also clear `lock_expires_at` (including `065` trip-status seat release ~line 788).
12. Extend `audit_log` action/entity CHECKs and `notifications` type/entity_type CHECKs (Sections 13–14).

### Deploy order (mandatory — B8)

1. `068` (column + 600s backfill).
2. **Same release window:** API cleanup (`index.ts`, `releaseExpiredLocks`) + Edge Function `release-expired-locks` + `lockSeat` writes `lock_expires_at`. Freeze shipping the Edge Function independently: a leftover cron on `locked_at + LOCK_TTL_SECONDS` would kill 15-minute link locks.
3. Only then `069` + public/agency link routes. **Do not create production links** until all three cleanups use `lock_expires_at`.

### Application changes

1. Update `lockSeat()` to always write `lock_expires_at = now + 600s`. **No `ttlOverride`.** Link flow extends via RPC only.
2. Update `unlockSeat()`/`unlockAllSeats()`/`unlockAllSeatsForUser()` to clear `lock_expires_at`.
3. Update cleanup queries (3 mechanisms) to `lock_expires_at < NOW()` and clear `lock_expires_at`.
4. Change `LOCK_TTL_SECONDS` default to **600**. Change frontend `NEXT_PUBLIC_LOCK_TTL_SECONDS` / `useLockCountdown` default to **600**. Update every test stub that hardcodes `300`.
5. Update `useLockCountdown` to read `lock_expires_at`.
6. Add `ReservationLinkService`.
7. Add `ReservationLinkController` with Zod schemas (`seat_code`, not `seat_id`).
8. Add agency routes.
9. Add public routes.
10. Add rate limiting.
11. Create public page (no `BusLayout`).
12. Add `/reservations/link` to `middleware.ts` `publicPaths`.
13. Create agency link management UI.
14. Add `PATCH` endpoint for agency data editing (RPC `patch_reservation_link_data`).
15. Extend Sentry `beforeSend` URL redaction + automated tests.
16. Patch `update_trip` + capacity-shrink service path for active link seats.
17. Every existing unlock/release path that nulls `locked_by` must also null `lock_expires_at` (`reservation.service.ts`, `index.ts`, Edge Function, `superadmin.service.ts` trip cancel, `065` RPCs).
18. Worker handlers + `AUDIT_*` TypeScript unions + notification CHECK-driven UI key.

---

## Section 23: Rollback Plan [PROPOSED — B7]

Confirmed reservations created via the link flow are **untouched**. Rollback removes the link mechanism, not tickets.

**Step 1: Application rollback** — revert all new files and modifications (`lockSeat` back to `locked_at`-only only if also rolling `068`; otherwise keep writing `lock_expires_at` if the column remains). Deploy first so no process calls `069` RPCs.

**Step 2: Restore wizard RPC, then drop 069 objects** — only after app rollback verified:

```sql
-- Restore create_agency_reservation body from migration 066
-- (CREATE OR REPLACE with the 066 definition). Do this BEFORE dropping
-- create_reservation_core if the wizard already delegates to it.

DROP FUNCTION IF EXISTS public.patch_reservation_link_data(UUID, UUID, JSONB);
DROP FUNCTION IF EXISTS public.public_save_reservation_link(TEXT, JSONB);
DROP FUNCTION IF EXISTS public.public_get_reservation_link(TEXT);
DROP FUNCTION IF EXISTS public.emit_reservation_link_event;
DROP FUNCTION IF EXISTS public.confirm_reservation_from_link(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.create_reservation_link(UUID, UUID, UUID, TEXT, UUID[]);
DROP FUNCTION IF EXISTS public.regenerate_reservation_link(UUID, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.cancel_reservation_link(UUID, UUID);
DROP FUNCTION IF EXISTS public.create_reservation_core(UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID[], TEXT[], TEXT[], TEXT[]);
```

**Step 2b: Restore CHECK constraints** to the 065 / 063 lists (`audit_log_action_check`, `audit_log_entity_type_check`, `notifications_type_check`, `notifications.entity_type`). Harmless if left expanded; a complete rollback restores them.

**Step 3: Drop `068` column** (only if rolling the lock-TTL change too):

```sql
ALTER TABLE seats DROP COLUMN IF EXISTS lock_expires_at;
```

If product keeps 10-minute wizard locks, **leave `lock_expires_at` and the three cleanups**; only roll the link RPCs/tables.

**Step 4: Drop `067` tables/triggers:**

```sql
DROP TRIGGER IF EXISTS trg_sync_active_on_seat_link ON public.reservation_link_seats;
DROP TRIGGER IF EXISTS trg_sync_link_status ON public.reservation_links;
DROP TRIGGER IF EXISTS reservation_links_updated_t ON public.reservation_links;
DROP FUNCTION IF EXISTS public.trg_sync_seat_link_active();
DROP FUNCTION IF EXISTS public.trg_sync_link_status_to_seats();
DROP TABLE IF EXISTS reservation_link_seats;
DROP TABLE IF EXISTS reservation_links;
```

Order is **069 RPCs → 068 column (optional) → 067 tables**. Never DROP tables while 069 functions still reference them. Never leave `create_agency_reservation` pointing at a dropped `create_reservation_core`.

**Data safety:** link rows are drafts. Confirmed `reservations` / `reserved` seats stay.

---

## Section 24: Monitoring [PROPOSED]

### Sentry

- Link creation failure → `{ area: 'reservation_link', action: 'create' }`
- Confirmation failure → `{ area: 'reservation_link', action: 'confirm' }`
- Seat uniqueness violation → `{ area: 'reservation_link', action: 'seat_conflict' }`

### Metrics

| Metric | What |
|---|---|
| Links created/day | Volume |
| Confirmed vs expired vs cancelled | Conversion rate |
| Avg time to confirmation | Passenger speed |
| Seat conflict rate | Uniqueness hits |
| Public page failures | Token not found / expired / trip changed |

---

## Section 25: Cost Analysis

### Database

- 2 new tables (`reservation_links`, `reservation_link_seats`).
- 1 partial unique index on `is_active`.
- 2 trigger functions for `is_active` sync.
- 1 `updated_at` trigger.
- 1 new column on `seats`.

### Compute

- No new background jobs.
- No new Edge Functions.

### Total: $0 additional

Within existing free tiers.

---

## Section 26: Dependencies

| Dependency | Status | Notes |
|---|---|---|
| `lockSeat`/`unlockSeat` | EXISTS | Modified: always 600s `lock_expires_at`; unlocks clear it |
| `create_agency_reservation` | EXISTS | Refactored to use shared core; **validation stays locked-by-self** |
| `crypto.randomBytes` | EXISTS | `backend/src/utils/token.ts` |
| `express-rate-limit` | EXISTS | Auth routes |
| `BusLayout` | EXISTS | **Not used on the public link page** (seat codes only) |
| `PassengerForm` | EXISTS | Public page style |
| `LockCountdown` | EXISTS | Modified to read `lock_expires_at`; default 600 |
| Outbox system | EXISTS | New event types; `passenger_data_saved` once per link_id |
| `update_updated_at` | EXISTS | `011_create_all.sql:12-18` |
| `agency_settings.logo_url` | EXISTS | `041_agency_settings.sql:17` |
| Sentry `beforeSend` | EXISTS | Must redact token in `request.url` (today it does not) |
| `middleware.ts` `publicPaths` | EXISTS | Must add `/reservations/link` |

---

## Section 27: Success Criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | Normal wizard locks seats for 10 minutes | `lock_expires_at = now + 600s` |
| 2 | Creating a link extends locks to 15 minutes atomically | `lock_expires_at` updated, no unlock/relock |
| 3 | Link expires after 15 minutes | Public GET returns 410 |
| 4 | Link expiration does not manually release seats | Seats remain until `lock_expires_at` |
| 5 | Seat cleanup uses `lock_expires_at` | Cleanup query uses new column |
| 6 | Partial passenger data can be saved | Save with 1/3 passengers succeeds |
| 7 | Confirmation requires name + document for all passengers | Incomplete → ERR_PASSENGER_INCOMPLETE |
| 8 | Phone remains optional | Confirm with empty phone succeeds |
| 9 | Agency can edit passenger data before confirmation | PATCH endpoint works |
| 10 | New link inherits draft data when regenerated | Regenerate preserves link_data |
| 11 | Cancelling `active` releases **agency-owned leftover locks only** | Other-agency locks and `reserved` seats untouched |
| 12 | Confirming creates exactly one reservation | One reservation per confirm |
| 13 | Trip changes invalidate links | Snapshot comparison returns 410 `TRIP_CHANGED` |
| 14 | Trip missing invalidates links | 410 `TRIP_MISSING` (no CASCADE of history) |
| 15 | Multiple active links allowed if seats disjoint | Two links succeed |
| 16 | Same seat cannot be in two active links | Unique index rejects on `is_active` UPDATE |
| 17 | Create link requires existing valid locks by creating user | Available/expired/other lock → rejected |
| 18 | Confirmation requires valid agency-owned locks | Available/expired/other-agency lock → rejected; colleague lock OK |
| 19 | Public API exposes minimal data | No trip_id, origin, price, UUIDs, link_id |
| 20 | Raw token never persisted/logged/Sentry URL | **Automated** `beforeSend` tests |
| 21 | No PII in outbox/Sentry | Code + tests |
| 22 | No public realtime | No Supabase realtime on public page |
| 23 | Wizard lock TTL is 10 minutes | Default 600s; countdown 600s; **this is a wizard change** |
| 24 | Confirmation reads link_data from DB | Not from request body |
| 25 | Save is full-state replacement | No merge, last-write-wins |
| 26 | Public errors carry distinct `code` | B11 table |
| 27 | passenger_data_saved once per link | PATCH does not emit |

---

## IMPLEMENTATION STATUS

```
DESIGN COMPLETE — VERIFIED READY
```

All technical decisions resolved and verified. Second adversarial audit: 0 blockers.

- [x] Confirmation requires valid active locks (locked_by **agency** + lock_expires_at > NOW)
- [x] Create-link requires lock owned by **creating user**
- [x] Cancel releases only agency-owned leftover locks
- [x] Confirm rejects departed trips (`ERR_TRIP_DEPARTED`) even if snapshot matches
- [x] Public/persisted `link_data` uses `seat_code` only
- [x] Confirm maps `ORDER BY reservation_link_seats.seat_code`
- [x] `trip_id ON DELETE RESTRICT`; missing trip → `TRIP_MISSING` 410
- [x] Cleanup uses `lock_expires_at` only; wizard TTL 600s; link extend 900s
- [x] Rollback restores `create_agency_reservation` from 066 before dropping core
- [x] Token URL redaction has automated tests
- [x] `passenger_data_saved` once per link; PATCH does not emit
- [x] Public errors use distinct `error.code`
- [x] Cancel of lazy-active (TTL passed, status still `active`) is allowed
- [x] Public GET/save are RPCs (no JS FOR UPDATE)
- [x] Outbox events have worker handlers + notification/audit CHECK extensions
- [x] Regenerate preserves same seats (no seat_ids parameter)
- [x] Save semantics are full-state replacement
- [x] Reservation creation shares existing business core (create_reservation_core)
- [x] Trip capacity included in change detection
- [x] Missing trip invalidates link
- [x] Create link requires existing valid locks (no available → locked)
- [x] Lock extension is atomic (UPDATE lock_expires_at only)
- [x] Agency edit endpoint defined (PATCH RPC)
- [x] Confirmation reads persisted link_data from DB
- [x] Seat uniqueness is DB-enforced (is_active + partial unique index + triggers)
- [x] No redundant token index (UNIQUE constraint suffices)
- [x] SQL/RPC snippets describe algorithms, not incomplete code

/**
 * @vitest-environment node
 *
 * RT-06 — contratos estáticos de Realtime de /agency/payments.
 *
 * Cubre lo que no puede probarse sin base remota: políticas RLS de la
 * migración 094, publicación Realtime, aislamiento por agency_id y el
 * cableado de suscripción/degradación en las tres vistas.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function read(rel: string) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

const MIGRATION = 'supabase/migrations/094_agency_payments_realtime.sql';
const ROLLBACK = 'supabase/rollbacks/094_agency_payments_realtime_rollback.sql';

describe('RT-06 · migración 094 (RLS agency + publicación)', () => {
  const sql = read(MIGRATION);

  it('crea policies de lectura espejo del backend (role agency + propia agency_id)', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS checkout_attempts_agency_read');
    expect(sql).toContain(
      'CREATE POLICY checkout_attempts_agency_read ON public.checkout_attempts',
    );
    expect(sql).toContain('DROP POLICY IF EXISTS payments_agency_read');
    expect(sql).toContain(
      'CREATE POLICY payments_agency_read ON public.payments',
    );
    // Patrón 039: nunca user_metadata / auth.jwt.
    expect(sql.match(/private\.auth_app_role\(\)\) = 'agency'/g)?.length).toBe(2);
    expect(
      sql.match(/agency_id = \(SELECT private\.auth_app_agency_id\(\)\)/g)?.length,
    ).toBe(2);
    expect(sql).not.toContain('user_metadata');
    expect(sql).not.toMatch(/auth\.jwt\s*\(/);
  });

  it('garantiza SELECT de authenticated sobre checkout_attempts (RT-06 auto-suficiente)', () => {
    expect(sql).toContain(
      'GRANT SELECT ON TABLE public.checkout_attempts TO authenticated;',
    );
    // El REVOKE de anon de 087 y la policy de cliente de 076/093 no se tocan
    // (solo se miran sentencias, no comentarios).
    expect(sql).not.toMatch(/^\s*REVOKE\s/im);
    expect(sql).not.toContain('DROP POLICY IF EXISTS checkout_attempts_customer_read');
    expect(sql).not.toContain('DROP POLICY IF EXISTS payments_customer_read');
  });

  it('publica ambas tablas con guarda de catálogo (PG17, reejecutable)', () => {
    expect(sql.match(/pg_publication_tables/g)?.length).toBe(2);
    expect(sql.match(/ALTER PUBLICATION supabase_realtime ADD TABLE/g)?.length).toBe(2);
    expect(sql).toContain("pubname = 'supabase_realtime'");
    expect(sql).toContain('ADD TABLE public.checkout_attempts');
    expect(sql).toContain('ADD TABLE public.payments');
    expect(sql).not.toContain('IF NOT EXISTS (TABLE');
  });

  it('no toca RPCs, TTLs, estados de compra ni flujos de abordaje', () => {
    // Sin funciones, sin DML y sin tocar locks: los TTLs (900/600) solo se
    // mencionan en comentarios para documentar que NO cambian.
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION');
    expect(sql).not.toMatch(/^\s*ALTER\s+FUNCTION/im);
    expect(sql).not.toMatch(/UPDATE\s+public\./);
    expect(sql).not.toMatch(/INSERT\s+INTO/);
    expect(sql).not.toMatch(/DELETE\s+FROM/);
    expect(sql).not.toContain('boarding');
  });
});

describe('RT-06 · rollback 094', () => {
  const sql = read(ROLLBACK);

  it('retira solo las dos policies agency', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS checkout_attempts_agency_read');
    expect(sql).toContain('DROP POLICY IF EXISTS payments_agency_read');
  });

  it('no retira publicación ni GRANT (compartidos con 093 / RT-04A)', () => {
    expect(sql).not.toContain('ALTER PUBLICATION');
    expect(sql).not.toMatch(/^\s*REVOKE\s/im);
    expect(sql).not.toContain('DROP POLICY IF EXISTS checkout_attempts_customer_read');
  });
});

describe('RT-06 · trabajo previo 093 intacto', () => {
  it('conserva el aporte de RT-04A (cliente) que RT-06 no modifica', () => {
    const sql = read('supabase/migrations/093_checkout_realtime.sql');
    expect(sql).toContain(
      'GRANT SELECT ON TABLE public.checkout_attempts TO authenticated;',
    );
    expect(sql).toContain('checkout_attempts_customer_read');
    expect(sql).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.payments');
  });
});

describe('RT-06 · helpers de suscripción (lib/realtime/subscriptions.ts)', () => {
  const subs = read('lib/realtime/subscriptions.ts');
  const rt06 = subs.slice(subs.indexOf('// RT-06 — Realtime de pagos'));

  it('exporta las cuatro suscripciones del módulo', () => {
    expect(subs).toContain('export function subscribeToAgencyCheckoutAttempts');
    expect(subs).toContain('export function subscribeToAgencyPayments');
    expect(subs).toContain('export function subscribeToAgencyPaymentReservation');
    expect(subs).toContain('export function subscribeToAgencyPaymentPassengers');
  });

  it('filtra por id en detalle y por agency_id en listado (rendimiento; RLS manda)', () => {
    expect(subs).toContain('`id=eq.${options.attemptId}`');
    expect(subs).toContain('`id=eq.${options.paymentId}`');
    expect(subs).toContain('`agency_id=eq.${options.agencyId}`');
    expect(subs).toContain('`id=eq.${reservationId}`');
    expect(subs).toContain('`reservation_id=eq.${reservationId}`');
    expect(rt06).toContain('autorización real');
    expect(rt06).toContain('policy 094');
  });

  it('es solo-notificación: nunca interpreta el payload del canal', () => {
    expect(rt06).toContain('() => onChange()');
    expect(rt06).not.toMatch(/\(payload/);
    expect(rt06).not.toContain('payload.new');
    expect(rt06).not.toContain('payload.eventType');
  });

  it('reporta estado de conexión por canal (banner de degradación)', () => {
    expect(rt06).toContain("status === 'SUBSCRIBED'");
    expect(rt06).toContain('onStatus?.(true)');
    expect(rt06).toContain('onStatus?.(false)');
    expect(rt06).toContain('console.warn');
  });
});

describe('RT-06 · hook useRealtimeRefresh', () => {
  const hook = read('hooks/useRealtimeRefresh.ts');

  it('debounce 500 ms y min-gap 700 ms entre refrescos', () => {
    expect(hook).toContain('REALTIME_REFRESH_DEBOUNCE_MS = 500');
    expect(hook).toContain('REALTIME_REFRESH_MIN_GAP_MS = 700');
  });

  it('limpia timer y suscripciones al desmontar', () => {
    expect(hook).toContain('clearTimeout(timerRef.current)');
    expect(hook).toMatch(/for \(const cleanup of cleanups\) cleanup\(\)/);
    expect(hook).toContain('active = false');
  });

  it('marca degradado si algún canal pierde la conexión', () => {
    expect(hook).toContain('statusRef.current.some((ok) => !ok)');
    expect(hook).toContain('refreshNow');
  });
});

describe('RT-06 · cableado de páginas', () => {
  const list = read('app/agency/payments/page.tsx');
  const payment = read('app/agency/payments/[id]/page.tsx');
  const attempt = read('app/agency/payments/attempts/[id]/page.tsx');

  it('listado: canales de attempts + payments por agencia y banner', () => {
    expect(list).toContain('subscribeToAgencyCheckoutAttempts');
    expect(list).toContain('subscribeToAgencyPayments');
    expect(list).toContain('agencyId');
    expect(list).toContain('useRealtimeRefresh');
    expect(list).toContain('Sin actualizaciones en vivo');
    expect(list).toContain('onClick={refreshNow}');
    expect(list).toContain('fetchSeqRef');
    expect(list).not.toContain('timerRef');
    expect(list).not.toContain('setInterval');
  });

  it('detalle de pago: canal del pago + reserva + pasajeros', () => {
    expect(payment).toContain('subscribeToAgencyPayments');
    expect(payment).toContain('paymentId: id');
    expect(payment).toContain('subscribeToAgencyPaymentReservation');
    expect(payment).toContain('subscribeToAgencyPaymentPassengers');
    expect(payment).toContain('isUuid(reservationId)');
    expect(payment).toContain('Sin actualizaciones en vivo');
    expect(payment).toContain('fetchSeqRef');
    expect(payment).not.toContain('timerRef');
  });

  it('detalle de compra: canal del intento por id, sin timers de refresco', () => {
    expect(attempt).toContain('subscribeToAgencyCheckoutAttempts');
    expect(attempt).toContain('attemptId: id');
    expect(attempt).toContain('Sin actualizaciones en vivo');
    expect(attempt).toContain('fetchSeqRef');
    expect(attempt).not.toContain('timerRef');
    // El refresco post-acción es inmediato y va por el hook.
    expect(attempt).toContain('refreshNow();');
    expect(attempt).not.toMatch(/setTimeout\(\(\) => \{\s*doFetch\(\);?\s*\}, 400\)/);
  });

  it('ninguna página usa polling', () => {
    expect(list).not.toContain('setInterval');
    expect(payment).not.toContain('setInterval');
    expect(attempt).not.toContain('setInterval');
  });
});

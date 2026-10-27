import 'dotenv/config';
import app from './app.js';
import { env } from './config/env.js';
import { supabaseAdmin } from './config/database.js';
import { completeExpiredTrips } from './services/trip.service.js';
import { initSentryFromEnv } from './observability/init-from-env.js';
import {
  captureException,
  flushSentry,
  fingerprintHttpError,
} from './observability/sentry.js';

initSentryFromEnv('api');

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  captureException(err, {
    tags: { service: 'api', status: 'fatal' },
    fingerprint: ['api', 'lifecycle', 'uncaughtException'],
    level: 'fatal',
  });
  void flushSentry(2000).finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  captureException(reason, {
    tags: { service: 'api', status: 'fatal' },
    fingerprint: ['api', 'lifecycle', 'unhandledRejection'],
    level: 'fatal',
  });
});

// Graceful shutdown — flush Sentry before exit (parity with Worker)
async function gracefulShutdown() {
  await flushSentry(2000);
  process.exit(0);
}
process.on('SIGTERM', () => { void gracefulShutdown(); });
process.on('SIGINT', () => { void gracefulShutdown(); });

// Auto-expiration for locked seats (every 60s)
// MKT-010: ANTES de liberar locks vencidos se cierran los intentos de
// checkout vencidos vía `cleanup_expired_checkout_attempts` (RPC 087):
// esa RPC libera, en la misma transacción, SOLO los locks que le
// pertenecen a cada intento. El release directo de abajo excluye los
// asientos con `checkout_attempt_id` para no destruir una compra en
// curso si el cleanup falló. El TTL interno de Tour (600 s) no cambia.
setInterval(async () => {
  try {
    const { error: cleanupError } = await supabaseAdmin.rpc(
      'cleanup_expired_checkout_attempts',
    );
    if (cleanupError) {
      console.error('[CheckoutCleanup] Error:', cleanupError.message);
      captureException(new Error(cleanupError.message), {
        tags: { service: 'api', area: 'checkout_cleanup' },
        fingerprint: fingerprintHttpError(500, 'CHECKOUT_CLEANUP'),
      });
    }

    const { data, error } = await supabaseAdmin
      .from('seats')
      .update({ status: 'available', locked_by: null, locked_at: null, lock_expires_at: null })
      .eq('status', 'locked')
      .lt('lock_expires_at', new Date().toISOString())
      .is('checkout_attempt_id', null)
      .select();
    if (error) {
      console.error('[LockCleanup] Error:', error.message);
      captureException(new Error(error.message), {
        tags: { service: 'api', area: 'lock_cleanup' },
        fingerprint: fingerprintHttpError(500, 'LOCK_CLEANUP'),
      });
    } else if ((data || []).length > 0) {
      console.log(`[LockCleanup] Released ${data!.length} expired lock(s)`);
    }
  } catch (err: any) {
    console.error('[LockCleanup] Error:', err.message);
    captureException(err, {
      tags: { service: 'api', area: 'lock_cleanup' },
      fingerprint: fingerprintHttpError(500, 'LOCK_CLEANUP'),
    });
  }
}, 60_000);

// Auto-complete expired trips (initial + every hour)
completeExpiredTrips().catch((error) => {
  console.error('[TripCleanup] Initial cleanup failed:', error);
  captureException(error, {
    tags: { service: 'api', area: 'trip_cleanup' },
    fingerprint: fingerprintHttpError(500, 'TRIP_CLEANUP'),
  });
});

setInterval(() => {
  completeExpiredTrips().catch((error) => {
    console.error('[TripCleanup] Failed:', error);
    captureException(error, {
      tags: { service: 'api', area: 'trip_cleanup' },
      fingerprint: fingerprintHttpError(500, 'TRIP_CLEANUP'),
    });
  });
}, 60 * 60 * 1000);

app.listen(env.PORT, () => {
  console.log(`[Nomadas Tour Backend] Running on port ${env.PORT} (${env.NODE_ENV})`);
});

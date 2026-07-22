import 'dotenv/config';
import app from './app.js';
import { env } from './config/env.js';
import { supabaseAdmin } from './config/database.js';
import { completeExpiredTrips } from './services/trip.service.js';

const LOCK_TTL_MS = env.LOCK_TTL_SECONDS * 1000;

// Auto-expiration for locked seats (every 60s)
setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - LOCK_TTL_MS).toISOString();
    const { data, error } = await supabaseAdmin
      .from('seats')
      .update({ status: 'available', locked_by: null, locked_at: null })
      .eq('status', 'locked')
      .lt('locked_at', cutoff)
      .select();
    if (error) {
      console.error('[LockCleanup] Error:', error.message);
    } else if ((data || []).length > 0) {
      console.log(`[LockCleanup] Released ${data!.length} expired lock(s)`);
    }
  } catch (err: any) {
    console.error('[LockCleanup] Error:', err.message);
  }
}, 60_000);

// Auto-complete expired trips (initial + every hour)
completeExpiredTrips().catch((error) => {
  console.error('[TripCleanup] Initial cleanup failed:', error);
});

setInterval(() => {
  completeExpiredTrips().catch((error) => {
    console.error('[TripCleanup] Failed:', error);
  });
}, 60 * 60 * 1000);

app.listen(env.PORT, () => {
  console.log(`[Nomadas Tour Backend] Running on port ${env.PORT} (${env.NODE_ENV})`);
});

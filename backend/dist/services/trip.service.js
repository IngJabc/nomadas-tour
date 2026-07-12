import { supabaseAdmin } from '../config/database.js';
export async function completeExpiredTrips() {
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
        .from('trips')
        .update({ status: 'completed' })
        .neq('status', 'completed')
        .lt('departure_time', cutoff)
        .select();
    if (error) {
        console.error('[TripCleanup] Error:', error.message);
        return;
    }
    const count = (data || []).length;
    if (count > 0) {
        console.log(`[TripCleanup] Completed ${count} expired trip(s)`);
    }
}
//# sourceMappingURL=trip.service.js.map
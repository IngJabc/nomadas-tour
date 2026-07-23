import { supabaseAdmin } from '../config/database.js';
import { notificationService } from './notification.service.js';

export async function completeExpiredTrips(): Promise<void> {
  const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('trips')
    .update({ status: 'completed' })
    .eq('status', 'active')
    .lt('departure_time', cutoff)
    .select();

  if (error) {
    console.error('[TripCleanup] Error:', error.message);
    return;
  }

  const count = (data || []).length;
  if (count > 0) {
    console.log(`[TripCleanup] Completed ${count} expired trip(s)`);

    // Send notifications for each auto-completed trip
    for (const trip of data || []) {
      // Get agencies assigned to this trip
      const { data: tripAgencies } = await supabaseAdmin
        .from('trip_agencies')
        .select('agency_id')
        .eq('trip_id', trip.id);

      const agencyIds = (tripAgencies || []).map((ta: any) => ta.agency_id);
      if (agencyIds.length === 0) continue;

      // Get route info
      const { data: route } = await supabaseAdmin
        .from('routes')
        .select('origin, destination')
        .eq('id', trip.route_id)
        .single();

      const routeLabel = route ? `${route.origin} → ${route.destination}` : 'viaje';

      // Notification: auto-completed → agencies + superadmin (system is the actor)
      notificationService.createForAgenciesAndAdmin({
        type: 'trip_auto_completed',
        title: 'Viaje completado automáticamente',
        body: `El viaje ${routeLabel} fue completado automáticamente`,
        entityType: 'trip',
        entityId: trip.id,
        agencyIds,
        actor: 'system',
      }).catch((err) => {
        console.error(JSON.stringify({ event: 'NOTIFICATION_FAILED', type: 'trip_auto_completed', tripId: trip.id, error: err.message }));
      });
    }
  }
}

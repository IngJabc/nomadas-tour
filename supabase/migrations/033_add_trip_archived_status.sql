-- Migration 033: Soft-delete via archived trip status + trip_archived notification type

ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_status_check;
ALTER TABLE trips ADD CONSTRAINT trips_status_check
  CHECK (status IN ('active', 'cancelled', 'completed', 'archived'));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'trip_created',
    'trip_cancelled',
    'trip_completed',
    'trip_auto_completed',
    'trip_postponed',
    'trip_deleted',
    'trip_archived',
    'reservation_created',
    'reservation_cancelled',
    'passenger_cancelled'
  ));

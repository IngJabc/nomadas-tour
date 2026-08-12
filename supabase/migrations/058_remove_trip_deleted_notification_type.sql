-- Migration 058: Remove dead notification type trip_deleted
-- trip_deleted belonged to the legacy hard-delete trip flow (removed on
-- 2026-07-28, deleteTrip -> archiveTrip). No emitter or consumer remains;
-- trip_archived is the functional replacement.
--
-- CHECK constraints only gate INSERT/UPDATE: existing historical rows of
-- notifications.type = 'trip_deleted' remain readable and untouched.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'trip_created',
    'trip_cancelled',
    'trip_completed',
    'trip_auto_completed',
    'trip_postponed',
    'trip_archived',
    'reservation_created',
    'reservation_cancelled',
    'passenger_cancelled'
  ));

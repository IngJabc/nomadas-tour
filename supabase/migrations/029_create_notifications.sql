-- Migration 029: Create notifications table for multi-tenant realtime notification system
-- Supports both agency and superadmin recipients with Realtime subscriptions

CREATE TABLE notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN (
    'trip_created',
    'trip_cancelled',
    'trip_completed',
    'trip_auto_completed',
    'trip_postponed',
    'trip_deleted',
    'reservation_created',
    'reservation_cancelled',
    'passenger_cancelled'
  )),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'trip',
    'reservation',
    'passenger'
  )),
  entity_id UUID NOT NULL,
  agency_id UUID REFERENCES agencies(id) ON DELETE CASCADE,
  recipient_role TEXT NOT NULL CHECK (recipient_role IN ('agency', 'superadmin')),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX idx_notifications_agency_id ON notifications(agency_id);
CREATE INDEX idx_notifications_recipient_role ON notifications(recipient_role);
CREATE INDEX idx_notifications_unread ON notifications(agency_id, read_at) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_entity ON notifications(entity_type, entity_id);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Agency: can only SELECT their own notifications
CREATE POLICY "notifications_agency_select" ON notifications
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

-- Agency: can only UPDATE their own notifications (mark as read)
CREATE POLICY "notifications_agency_update" ON notifications
  FOR UPDATE USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

-- Superadmin: can SELECT all notifications
CREATE POLICY "notifications_superadmin_select" ON notifications
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin'
  );

-- Superadmin: can UPDATE all notifications (mark as read)
CREATE POLICY "notifications_superadmin_update" ON notifications
  FOR UPDATE USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin'
  );

-- No INSERT policy for frontend — backend uses supabaseAdmin (service_role) to insert
-- No DELETE policy — notifications are never deleted by frontend

-- Add to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Migration 032: Agency notification preferences (in-app + email per category)

CREATE TABLE agency_notification_preferences (
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'trip_assignments',
    'trip_schedule_changes',
    'trip_status_updates',
    'trip_cancellations'
  )),
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agency_id, category)
);

CREATE INDEX idx_agency_notif_prefs_agency
  ON agency_notification_preferences(agency_id);

CREATE OR REPLACE FUNCTION enforce_locked_notification_categories()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.category = 'trip_cancellations'
     AND (NEW.in_app_enabled = FALSE OR NEW.email_enabled = FALSE) THEN
    RAISE EXCEPTION 'trip_cancellations cannot be disabled';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_locked_notification_categories
  BEFORE INSERT OR UPDATE ON agency_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION enforce_locked_notification_categories();

ALTER TABLE agency_notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agency_notif_prefs_select" ON agency_notification_preferences
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

CREATE POLICY "superadmin_notif_prefs_select" ON agency_notification_preferences
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin'
  );

-- Backfill defaults for existing agencies
INSERT INTO agency_notification_preferences (agency_id, category)
SELECT a.id, c.category
FROM agencies a
CROSS JOIN (VALUES
  ('trip_assignments'),
  ('trip_schedule_changes'),
  ('trip_status_updates'),
  ('trip_cancellations')
) AS c(category)
ON CONFLICT DO NOTHING;

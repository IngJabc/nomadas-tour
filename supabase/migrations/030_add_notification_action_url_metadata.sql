-- Migration 030: Prepare notifications for deep links and contextual metadata
-- Phase 1 infrastructure: action_url and metadata columns
-- No existing data is modified. All new columns are nullable or have defaults.

-- action_url: internal route where the user should be redirected on click.
-- NULL means the notification has no associated navigation (legacy or system events).
ALTER TABLE notifications
ADD COLUMN action_url TEXT;

-- metadata: additional contextual information for enriching the UI in future phases.
-- Contains event-specific data such as origin, destination, passenger name, etc.
-- Default is an empty JSON object so existing rows and new inserts without metadata stay valid.
ALTER TABLE notifications
ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;

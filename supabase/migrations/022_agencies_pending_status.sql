-- Fix agencies CHECK constraint to allow 'pending' status
-- The original 011 migration only allowed 'active' and 'inactive'
-- but createAgency() inserts 'pending' for new agencies

ALTER TABLE agencies DROP CONSTRAINT agencies_status_check;

ALTER TABLE agencies ADD CONSTRAINT agencies_status_check
  CHECK (status IN ('active', 'inactive', 'pending'));

ALTER TABLE agency_invitations
ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id),
ADD COLUMN IF NOT EXISTS email TEXT;

CREATE INDEX IF NOT EXISTS idx_invitations_agency_id ON agency_invitations(agency_id);

-- Re-add postponed_from column to trips table (was added in 008, lost in 010_drop_all)
ALTER TABLE trips ADD COLUMN IF NOT EXISTS postponed_from TIMESTAMPTZ;

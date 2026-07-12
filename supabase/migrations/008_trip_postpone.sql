-- Add postponed_from column to trips table to track original departure time when a trip is postponed
ALTER TABLE trips ADD COLUMN IF NOT EXISTS postponed_from TIMESTAMPTZ;

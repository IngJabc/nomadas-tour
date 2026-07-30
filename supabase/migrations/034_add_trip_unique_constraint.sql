-- Migration 034: Prevent duplicate trips for the same route + departure_time

DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT route_id, departure_time
    FROM trips
    GROUP BY route_id, departure_time
    HAVING COUNT(*) > 1
  ) dup;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add UNIQUE(route_id, departure_time): % duplicate slot(s) exist. Resolve duplicates before applying migration.',
      duplicate_count;
  END IF;
END $$;

ALTER TABLE trips
  ADD CONSTRAINT trips_route_departure_unique UNIQUE (route_id, departure_time);

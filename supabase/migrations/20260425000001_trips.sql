-- Trips: ordered list of stops with per-segment travel mode.
-- Dates live on individual stops (date_time). Trip span is derived from
-- min/max of its stops' date_times — no denormalised duplicate on the trip row.
-- Each stop also stores the travel mode for the segment leaving it
-- (so a trip can mix bike → transit → bike → walk, etc.).

CREATE TABLE IF NOT EXISTS trips (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL DEFAULT 'Untitled trip',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE INDEX IF NOT EXISTS trips_user_updated ON trips(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS trip_stops (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id          uuid        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  place_id         uuid        NOT NULL REFERENCES user_places(id) ON DELETE CASCADE,
  order_idx        integer     NOT NULL,
  -- When the user is at (or arrives at) this stop. Optional; trip date span
  -- is computed from min/max across stops with date_time set.
  date_time        timestamptz,
  -- Travel mode for the segment LEAVING this stop. NULL on the last stop.
  profile_to_next  text        CHECK (profile_to_next IN ('walk', 'bike', 'transit', 'drive')),
  -- Drag-to-refine waypoints inserted into the segment leaving this stop.
  -- Shape: [{"lat": 37.1, "lng": -122.0}, ...]
  via_waypoints    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_stops_trip_order ON trip_stops(trip_id, order_idx);
CREATE INDEX IF NOT EXISTS trip_stops_place      ON trip_stops(place_id);

ALTER TABLE trips      ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_stops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their trips"
  ON trips FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage stops on their trips"
  ON trip_stops FOR ALL
  USING (EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_stops.trip_id AND t.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_stops.trip_id AND t.user_id = auth.uid()));

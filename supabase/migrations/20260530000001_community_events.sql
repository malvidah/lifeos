-- Community events system: scraped/imported public events per user
-- and event sources (feeds a user subscribes to)

DO $$ BEGIN

-- ─── community_events ─────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'community_events') THEN
  CREATE TABLE community_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source text NOT NULL,           -- e.g. 'nerdnite', 'shift2bikes', '19hz', 'manual'
    source_url text,                -- original event URL
    source_event_id text,           -- dedup key from source
    title text NOT NULL,
    description text,
    venue text,                     -- venue name
    address text,
    lat double precision,
    lng double precision,
    category text DEFAULT 'other',  -- 'music', 'art', 'outdoors', 'lectures', 'sports', 'food', 'community', 'other'
    starts_at timestamptz NOT NULL,
    ends_at timestamptz,
    cost text,                      -- '$12', 'free', 'sliding scale'
    image_url text,
    tags text[] DEFAULT '{}',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
  );

  ALTER TABLE community_events ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "users manage own community_events" ON community_events
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

  CREATE INDEX IF NOT EXISTS community_events_user_date_idx
    ON community_events (user_id, starts_at);

  CREATE UNIQUE INDEX IF NOT EXISTS community_events_dedup_idx
    ON community_events (user_id, source, source_event_id)
    WHERE source_event_id IS NOT NULL;
END IF;

-- ─── event_sources ────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'event_sources') THEN
  CREATE TABLE event_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name text NOT NULL,             -- display name
    source_type text NOT NULL,      -- 'ical', 'rss', 'scraper', 'manual'
    url text,                       -- feed URL for ical/rss, or website URL for scrapers
    scraper_key text,               -- which scraper to use (e.g. '19hz', 'shift2bikes')
    category text DEFAULT 'community',
    venue text,                     -- default venue name
    lat double precision,           -- default venue coords
    lng double precision,
    enabled boolean DEFAULT true,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now()
  );

  ALTER TABLE event_sources ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "users manage own event_sources" ON event_sources
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
END IF;

END $$;

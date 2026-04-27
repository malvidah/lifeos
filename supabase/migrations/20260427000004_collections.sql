-- Collections: user-curated lists of places (e.g. "Bay Area Guide", "NYC faves").
-- A place can belong to many collections; a collection can contain many places.
-- This is DIFFERENT from user_place_types (which is the tag/category — food,
-- bars, experiences). Tags are taxonomy; collections are curation.

CREATE TABLE IF NOT EXISTS user_collections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text,
  position    int DEFAULT 0,
  is_public   boolean NOT NULL DEFAULT false,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE user_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own collections" ON user_collections FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS user_collections_user_idx ON user_collections (user_id, position);

CREATE TABLE IF NOT EXISTS user_collection_places (
  collection_id  uuid NOT NULL REFERENCES user_collections(id) ON DELETE CASCADE,
  place_id       uuid NOT NULL REFERENCES user_places(id) ON DELETE CASCADE,
  position       int DEFAULT 0,
  created_at     timestamptz DEFAULT now(),
  PRIMARY KEY (collection_id, place_id)
);

ALTER TABLE user_collection_places ENABLE ROW LEVEL SECURITY;
-- A user can read/write a join row iff they own the collection it points to.
CREATE POLICY "Users manage own collection memberships"
  ON user_collection_places FOR ALL
  USING (EXISTS (SELECT 1 FROM user_collections c WHERE c.id = collection_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM user_collections c WHERE c.id = collection_id AND c.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS user_collection_places_collection_idx ON user_collection_places (collection_id, position);
CREATE INDEX IF NOT EXISTS user_collection_places_place_idx      ON user_collection_places (place_id);

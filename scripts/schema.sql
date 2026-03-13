-- Day Lab — Full Schema
-- Run this in Supabase SQL Editor to create all required tables.
-- Safe to re-run: all statements use CREATE TABLE IF NOT EXISTS.

-- ── Enable UUID extension (already on by default in Supabase) ────────────────
create extension if not exists "pgcrypto";


-- ── entries ──────────────────────────────────────────────────────────────────
-- Generic key/value store keyed by (user_id, date, type).
-- Used for: daily health data, journal, tasks, OAuth tokens, settings, scores, etc.
create table if not exists entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        text not null,          -- YYYY-MM-DD
  type        text not null,          -- e.g. 'journal', 'tasks', 'scores', 'oura_token'
  data        jsonb not null default '{}',
  updated_at  timestamptz not null default now(),
  unique (user_id, date, type)
);
create index if not exists entries_user_date on entries(user_id, date);
alter table entries enable row level security;
create policy if not exists "entries: owner only" on entries
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ── user_settings ─────────────────────────────────────────────────────────────
-- One row per user. Stores tokens, project settings, app preferences as JSON.
create table if not exists user_settings (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  data        jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);
alter table user_settings enable row level security;
create policy if not exists "user_settings: owner only" on user_settings
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ── journal_blocks ────────────────────────────────────────────────────────────
-- One row per journal note. content is plain text; project_tags is an array of project names.
create table if not exists journal_blocks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  date         text not null,          -- YYYY-MM-DD
  content      text not null default '',
  project_tags text[] not null default '{}',
  updated_at   timestamptz not null default now()
);
create index if not exists journal_blocks_user on journal_blocks(user_id);
create index if not exists journal_blocks_tags on journal_blocks using gin(project_tags);
alter table journal_blocks enable row level security;
create policy if not exists "journal_blocks: owner only" on journal_blocks
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ── tasks ─────────────────────────────────────────────────────────────────────
-- One row per task item.
create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  date         text not null,          -- YYYY-MM-DD
  text         text not null default '',
  html         text,
  done         boolean not null default false,
  project_tags text[] not null default '{}',
  updated_at   timestamptz not null default now()
);
create index if not exists tasks_user on tasks(user_id);
create index if not exists tasks_tags on tasks using gin(project_tags);
alter table tasks enable row level security;
create policy if not exists "tasks: owner only" on tasks
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ── workouts ──────────────────────────────────────────────────────────────────
-- Merged Oura workouts + Strava activities, deduplicated by (user_id, source, external_id).
create table if not exists workouts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  date         text not null,          -- YYYY-MM-DD
  source       text not null,          -- 'oura' | 'strava' | 'garmin'
  external_id  text,                   -- provider's activity ID
  type         text,                   -- 'Run', 'Ride', 'WeightTraining', etc.
  title        text,
  duration_min numeric,
  distance_m   numeric,
  calories     numeric,
  avg_hr       numeric,
  project_tags text[] not null default '{}',
  raw          jsonb,                  -- extra provider-specific fields
  updated_at   timestamptz not null default now(),
  unique (user_id, source, external_id)
);
create index if not exists workouts_user_date on workouts(user_id, date);
create index if not exists workouts_tags on workouts using gin(project_tags);
alter table workouts enable row level security;
create policy if not exists "workouts: owner only" on workouts
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ── meal_items ────────────────────────────────────────────────────────────────
-- Individual food/meal log entries with AI-estimated nutrition.
create table if not exists meal_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  date         text not null,          -- YYYY-MM-DD
  content      text not null default '',
  ai_protein   numeric,                -- grams, AI estimate
  ai_calories  numeric,                -- kcal, AI estimate
  project_tags text[] not null default '{}',
  updated_at   timestamptz not null default now()
);
create index if not exists meal_items_user_date on meal_items(user_id, date);
create index if not exists meal_items_tags on meal_items using gin(project_tags);
alter table meal_items enable row level security;
create policy if not exists "meal_items: owner only" on meal_items
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

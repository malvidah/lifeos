-- User locations: one row per user per date for historical location tracking
create table if not exists user_locations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  lat double precision not null,
  lng double precision not null,
  city text,
  country text,
  created_at timestamptz default now(),
  unique(user_id, date)
);

create index if not exists idx_user_locations_user_date on user_locations(user_id, date);

alter table user_locations enable row level security;

create policy "Users manage own locations"
  on user_locations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

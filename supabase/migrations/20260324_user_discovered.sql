-- Discovered places: countries and cities the user has visited
create table if not exists user_discovered (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  country text not null,       -- country name for GeoJSON boundary matching
  type text default 'city',    -- country, state, city, region
  lat double precision,
  lng double precision,
  created_at timestamptz default now()
);

create index if not exists idx_user_discovered_user on user_discovered(user_id);

alter table user_discovered enable row level security;

create policy "Users manage own discovered"
  on user_discovered for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

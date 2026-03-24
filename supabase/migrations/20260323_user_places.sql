-- Saved places: cafes, viewpoints, landmarks the user wants to remember
create table if not exists user_places (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  lat double precision not null,
  lng double precision not null,
  name text not null,
  category text default 'pin',  -- pin, cafe, food, viewpoint, park, shop, home, work, etc.
  notes text,
  color text,  -- optional hex override
  created_at timestamptz default now()
);

create index if not exists idx_user_places_user on user_places(user_id);

alter table user_places enable row level security;

create policy "Users manage own places"
  on user_places for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

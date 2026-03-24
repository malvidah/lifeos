-- User-defined place types (pin categories with custom colors)
create table if not exists user_place_types (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  color text not null,  -- hex color for pin
  position int default 0,
  created_at timestamptz default now(),
  unique(user_id, name)
);

create index if not exists idx_user_place_types_user on user_place_types(user_id);

alter table user_place_types enable row level security;

create policy "Users manage own place types"
  on user_place_types for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

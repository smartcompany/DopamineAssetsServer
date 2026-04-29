create table if not exists public.dopamine_user_badges (
  uid text primary key,
  unlocked_keys text[] not null default '{}'::text[],
  counters jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_dopamine_user_badges_updated_at
  on public.dopamine_user_badges (updated_at desc);

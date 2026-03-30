-- GitHub Actions가 Bybit 스팟 티커 JSON을 넣고, Vercel API는 읽기만.

create table if not exists public.dopamine_crypto_feed_cache (
  id text primary key,
  items jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists dopamine_crypto_feed_cache_updated_idx
  on public.dopamine_crypto_feed_cache (updated_at desc);

alter table public.dopamine_crypto_feed_cache enable row level security;

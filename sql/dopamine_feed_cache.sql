-- GitHub Actions가 코인·한국·미국·원자재 랭킹 원천 JSON을 넣고, Vercel API는 읽기만.

create table if not exists public.dopamine_feed_cache (
  id text primary key,
  items jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists dopamine_feed_cache_updated_idx
  on public.dopamine_feed_cache (updated_at desc);

alter table public.dopamine_feed_cache enable row level security;

-- 기존 `dopamine_crypto_feed_cache`(bybit_spot_usdt) → crypto 행으로 이전 (한 번만 실행)
insert into public.dopamine_feed_cache (id, items, updated_at)
select 'crypto', items, updated_at
from public.dopamine_crypto_feed_cache
where id = 'bybit_spot_usdt'
on conflict (id) do nothing;

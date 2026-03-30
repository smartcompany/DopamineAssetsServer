-- 테마 지표( hot/crashed/emerging ) 캐시 (GitHub Actions → Vercel은 읽기만).
create table if not exists public.dopamine_theme_cache (
  id text primary key,
  items jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists dopamine_theme_cache_updated_idx
  on public.dopamine_theme_cache (updated_at desc);

alter table public.dopamine_theme_cache enable row level security;

-- 테마 캔들 차트( themeId + rangeDays ) 캐시.
create table if not exists public.dopamine_theme_chart_cache (
  id text primary key,
  items jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists dopamine_theme_chart_cache_updated_idx
  on public.dopamine_theme_chart_cache (updated_at desc);

alter table public.dopamine_theme_chart_cache enable row level security;


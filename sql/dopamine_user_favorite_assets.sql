-- 사용자 관심 종목 (Firebase uid 기준; Next API + service role로만 접근)
create table if not exists public.dopamine_user_favorite_assets (
  user_uid text not null,
  symbol text not null,
  asset_class text not null,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_uid, asset_class, symbol),
  constraint dopamine_user_favorite_assets_class_check check (
    asset_class in ('us_stock', 'kr_stock', 'crypto', 'commodity', 'theme')
  ),
  constraint dopamine_user_favorite_assets_symbol_len check (
    char_length(symbol) between 1 and 128
  ),
  constraint dopamine_user_favorite_assets_display_name_len check (
    char_length(display_name) <= 200
  )
);

create index if not exists dopamine_user_favorite_assets_user_created_idx
  on public.dopamine_user_favorite_assets (user_uid, created_at desc);

alter table public.dopamine_user_favorite_assets enable row level security;

comment on table public.dopamine_user_favorite_assets is
  '앱 관심 종목. 클라이언트는 /api/profile/favorites (Firebase Bearer) 경유.';

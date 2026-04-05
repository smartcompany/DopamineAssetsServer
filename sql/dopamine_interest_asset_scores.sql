-- 관심 자산 일별 점수. 클라이언트는 Next API만 사용 → anon/authenticated 직접 접근 없음.
-- RLS 활성 + 역할별 정책 없음 = anon·authenticated 는 행 접근 불가. service_role 만 upsert/조회.

create table if not exists public.dopamine_interest_asset_scores (
  symbol text primary key,
  name text not null,
  category text not null,
  score_history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint dopamine_interest_asset_scores_category_check check (
    category in ('us_stock', 'kr_stock', 'commodity', 'crypto')
  ),
  constraint dopamine_interest_asset_scores_symbol_len check (
    char_length(symbol) between 1 and 64
  )
);

create index if not exists dopamine_interest_asset_scores_updated_idx
  on public.dopamine_interest_asset_scores (updated_at desc);

drop policy if exists dopamine_interest_asset_scores_anon_all
  on public.dopamine_interest_asset_scores;

alter table public.dopamine_interest_asset_scores enable row level security;

revoke all on table public.dopamine_interest_asset_scores from anon;
revoke all on table public.dopamine_interest_asset_scores from authenticated;

grant select, insert, update, delete on table public.dopamine_interest_asset_scores to service_role;

comment on table public.dopamine_interest_asset_scores is
  '관심 자산 일별 점수·순위. category=us_stock|kr_stock|commodity|crypto. API(service_role)만 접근.';

comment on column public.dopamine_interest_asset_scores.score_history is
  'JSON 배열: {date, score, rank}. 날짜 오름차순 권장.';

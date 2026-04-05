-- OpenAI 관심 자산 TOP50 일별 점수 히스토리 (GitHub Actions feed-cache 와 함께 갱신)
-- score_history: [{"date":"YYYY-MM-DD","score":98,"rank":3}, ...] 동일 date 있으면 덮어쓰기

create table if not exists public.dopamine_interest_asset_scores (
  symbol text primary key,
  name text not null,
  category text not null,
  score_history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint dopamine_interest_asset_scores_category_check check (
    category in ('stock_us', 'stock_kr', 'commodity', 'crypto')
  ),
  constraint dopamine_interest_asset_scores_symbol_len check (
    char_length(symbol) between 1 and 64
  )
);

create index if not exists dopamine_interest_asset_scores_updated_idx
  on public.dopamine_interest_asset_scores (updated_at desc);

alter table public.dopamine_interest_asset_scores enable row level security;

grant select, insert, update, delete on public.dopamine_interest_asset_scores to anon, authenticated;

create policy dopamine_interest_asset_scores_anon_all
  on public.dopamine_interest_asset_scores
  for all
  to anon, authenticated
  using (true)
  with check (true);

comment on table public.dopamine_interest_asset_scores is
  '관심 자산 일별 점수·순위. GitHub Actions가 interest API 결과로 score_history 병합(동일 date 덮어쓰기).';

comment on column public.dopamine_interest_asset_scores.score_history is
  'JSON 배열: {date, score, rank}. 날짜 오름차순 권장.';

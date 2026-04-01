-- 뉴스 AI 요약 캐시 v2: 캐시 키 = 티커(symbol) + 제목 지문(title_digest) 만 사용.
-- 기존 v1 테이블이 있으면 삭제 후 재생성합니다(캐시 무효화).
drop table if exists public.dopamine_news_ai_summary_cache cascade;

create table public.dopamine_news_ai_summary_cache (
  cache_key text primary key,
  symbol text not null,
  title_digest text not null,
  summary text not null,
  impact jsonb not null default '[]'::jsonb,
  risk jsonb not null default '[]'::jsonb,
  source_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index dopamine_news_ai_summary_cache_symbol_idx
  on public.dopamine_news_ai_summary_cache (symbol);

alter table public.dopamine_news_ai_summary_cache enable row level security;

comment on table public.dopamine_news_ai_summary_cache is
  '광고 후 뉴스 AI 요약 캐시. cache_key = sha256(v2|SYMBOL|title_digest).';

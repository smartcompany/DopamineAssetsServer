-- 뉴스 AI 요약 캐시 v2: 캐시 키 = 티커(symbol) + 제목 지문(title_digest) 만 사용.
-- 기존 v1 테이블이 있으면 삭제 후 재생성합니다(캐시 무효화).
--
-- NEXT_PUBLIC(anon) 키만 쓰는 경우: RLS 켠 뒤 아래 정책으로 API(anon)에서 upsert 가능.
-- (anon 키는 클라이언트에도 노출될 수 있어, 이 테이블은 캐시 전용으로만 쓰는 것을 권장합니다.)
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

grant select, insert, update, delete on public.dopamine_news_ai_summary_cache to anon, authenticated;

create policy dopamine_news_ai_summary_cache_anon_all
  on public.dopamine_news_ai_summary_cache
  for all
  to anon, authenticated
  using (true)
  with check (true);

comment on table public.dopamine_news_ai_summary_cache is
  '광고 후 뉴스 AI 요약 캐시. cache_key = sha256(v2|SYMBOL|title_digest).';

-- 배치(LLM)로 생성한 자산별 급등·급락 요약 (자산당·일자당 1행)
-- 서버 .env: OPENAI_API_KEY, OPENAI_MODEL(선택, 기본 gpt-5-mini), CRON_SECRET, NEXT_PUBLIC_SUPABASE_* + 서비스 롤,
--            MOVE_SUMMARY_BATCH_SIZE(기본 8), MOVE_SUMMARY_RANK_LIMIT(기본 15)
-- 트리거: POST 또는 GET /api/cron/asset-move-summaries — Authorization: Bearer <CRON_SECRET> 또는 ?secret=
create table if not exists public.dopamine_asset_move_summaries (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  asset_class text not null,
  summary_date date not null,
  summary_ko text not null,
  model text,
  batch_run_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint dopamine_move_summaries_class check (
    asset_class in ('us_stock', 'kr_stock', 'crypto', 'commodity')
  ),
  constraint dopamine_move_summaries_unique unique (symbol, asset_class, summary_date)
);

create index if not exists dopamine_move_summaries_lookup_idx
  on public.dopamine_asset_move_summaries (symbol, asset_class, summary_date desc);

-- 이미 dopamine_news_ai_summary_cache 테이블만 있고 anon upsert 가 막힐 때 1회 실행.
-- (전체 재적용은 dopamine_news_ai_summary_cache.sql 사용)

grant select, insert, update, delete on public.dopamine_news_ai_summary_cache to anon, authenticated;

drop policy if exists dopamine_news_ai_summary_cache_anon_all on public.dopamine_news_ai_summary_cache;

create policy dopamine_news_ai_summary_cache_anon_all
  on public.dopamine_news_ai_summary_cache
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- 기존 Supabase DB에 jp_stock / cn_stock 자산군 허용 (한 번만 실행).
-- 새 프로젝트는 apply_all_supabase.sql 또는 개별 *.sql 로 이미 반영됨.

alter table public.dopamine_asset_comments
  drop constraint if exists dopamine_asset_comments_class_check;
alter table public.dopamine_asset_comments
  add constraint dopamine_asset_comments_class_check check (
    asset_class in ('us_stock', 'kr_stock', 'jp_stock', 'cn_stock', 'crypto', 'commodity', 'theme')
  );

alter table public.dopamine_asset_move_summaries
  drop constraint if exists dopamine_move_summaries_class;
alter table public.dopamine_asset_move_summaries
  add constraint dopamine_move_summaries_class check (
    asset_class in ('us_stock', 'kr_stock', 'jp_stock', 'cn_stock', 'crypto', 'commodity', 'theme')
  );

alter table public.dopamine_interest_asset_scores
  drop constraint if exists dopamine_interest_asset_scores_category_check;
alter table public.dopamine_interest_asset_scores
  add constraint dopamine_interest_asset_scores_category_check check (
    category in ('us_stock', 'kr_stock', 'jp_stock', 'cn_stock', 'commodity', 'crypto')
  );

alter table public.dopamine_user_favorite_assets
  drop constraint if exists dopamine_user_favorite_assets_class_check;
alter table public.dopamine_user_favorite_assets
  add constraint dopamine_user_favorite_assets_class_check check (
    asset_class in ('us_stock', 'kr_stock', 'jp_stock', 'cn_stock', 'crypto', 'commodity', 'theme')
  );

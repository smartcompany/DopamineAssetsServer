-- 기존 DB: 커뮤니티 댓글에 asset_class = 'theme' 허용 (테마 토론)
alter table public.dopamine_asset_comments
  drop constraint if exists dopamine_asset_comments_class_check;

alter table public.dopamine_asset_comments
  add constraint dopamine_asset_comments_class_check check (
    asset_class in ('us_stock', 'kr_stock', 'jp_stock', 'cn_stock', 'crypto', 'commodity', 'theme')
  );

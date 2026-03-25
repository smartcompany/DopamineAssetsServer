-- 선택 제목·이미지 URL (커뮤니티 루트 글 등). Supabase SQL 에디터에서 실행하세요.

alter table public.dopamine_asset_comments
  add column if not exists title text;

alter table public.dopamine_asset_comments
  add column if not exists image_urls text[] not null default '{}';

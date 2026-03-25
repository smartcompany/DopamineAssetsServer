-- 커뮤니티 글에 선택 시점 종목 표시명 저장 (랭킹의 name 등)
alter table public.dopamine_asset_comments
  add column if not exists asset_display_name text;

comment on column public.dopamine_asset_comments.asset_display_name is
  '글 작성 시 클라이언트가 넘긴 종목명(표시용). 없으면 심볼만 표시.';

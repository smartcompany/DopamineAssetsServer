-- 신고/AI/관리자에 의한 글 숨김(차단). 값이 있으면 일반 API에서 노출하지 않습니다(삭제 아님).
-- dopamine_asset_comments 가 있는 DB에 적용하세요.

alter table public.dopamine_asset_comments
  add column if not exists moderation_hidden_at timestamptz;

comment on column public.dopamine_asset_comments.moderation_hidden_at is
  '비NULL이면 피드·종목 댓글·스레드 등에서 사용자에게 비노출(차단). 대시보드에서는 조회 가능.';

create index if not exists dopamine_asset_comments_moderation_hidden_idx
  on public.dopamine_asset_comments (moderation_hidden_at)
  where moderation_hidden_at is not null;

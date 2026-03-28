-- 커뮤니티 글(루트 댓글) 신고 기록. dopamine_asset_comments 가 있는 DB에 적용하세요.
-- 대시보드·AI 판정·스냅샷: dopamine_comment_reports_dashboard.sql
-- 글 숨김(차단) 플래그: dopamine_asset_comments_moderation_hidden.sql

create table if not exists public.dopamine_comment_reports (
  comment_id uuid not null references public.dopamine_asset_comments (id) on delete cascade,
  reporter_uid text not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (comment_id, reporter_uid)
);

alter table public.dopamine_comment_reports enable row level security;

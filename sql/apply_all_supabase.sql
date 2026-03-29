-- =============================================================================
-- DopamineAssets — Supabase 한 번에 적용용 통합 스크립트
-- =============================================================================
-- 사용: Supabase Dashboard → SQL Editor → 이 파일 전체 복사 → Run (한 번)
--
-- 주의
--   · 이미 같은 테이블/컬럼이 있으면 IF NOT EXISTS / IF NOT EXISTS 인덱스는 건너뜁니다.
--   · 신고 테이블을 예전 방식으로 직접 만져 둔 DB는 충돌할 수 있습니다. 그때는 개별 sql을 보세요.
--   · 급등·급락 요약 크론을 쓰지 않으면 마지막 섹션(8)은 생략해도 됩니다.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) 자산 댓글 / 커뮤니티 글 (루트·스레드)
-- ---------------------------------------------------------------------------
create table if not exists public.dopamine_asset_comments (
  id uuid primary key default gen_random_uuid(),
  asset_symbol text not null,
  asset_class text not null,
  parent_id uuid references public.dopamine_asset_comments (id) on delete cascade,
  body text not null,
  author_uid text not null,
  author_display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dopamine_asset_comments_body_len check (
    char_length(body) between 1 and 2000
  ),
  constraint dopamine_asset_comments_class_check check (
    asset_class in ('us_stock', 'kr_stock', 'crypto', 'commodity', 'theme')
  )
);
alter table public.dopamine_asset_comments enable row level security;

create index if not exists dopamine_asset_comments_asset_idx
  on public.dopamine_asset_comments (asset_symbol, asset_class, created_at asc);

create index if not exists dopamine_asset_comments_parent_idx
  on public.dopamine_asset_comments (parent_id);

-- ---------------------------------------------------------------------------
-- 2) 제목·이미지
-- ---------------------------------------------------------------------------
alter table public.dopamine_asset_comments
  add column if not exists title text;

alter table public.dopamine_asset_comments
  add column if not exists image_urls text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- 3) 종목 표시명
-- ---------------------------------------------------------------------------
alter table public.dopamine_asset_comments
  add column if not exists asset_display_name text;

comment on column public.dopamine_asset_comments.asset_display_name is
  '글 작성 시 클라이언트가 넘긴 종목명(표시용). 없으면 심볼만 표시.';

-- ---------------------------------------------------------------------------
-- 4) 신고/관리 비노출 플래그 (moderation_hidden_at)
-- ---------------------------------------------------------------------------
alter table public.dopamine_asset_comments
  add column if not exists moderation_hidden_at timestamptz;

comment on column public.dopamine_asset_comments.moderation_hidden_at is
  '비NULL이면 피드·종목 댓글·스레드 등에서 사용자에게 비노출(차단). 대시보드에서는 조회 가능.';

create index if not exists dopamine_asset_comments_moderation_hidden_idx
  on public.dopamine_asset_comments (moderation_hidden_at)
  where moderation_hidden_at is not null;

-- ---------------------------------------------------------------------------
-- 5) 프로필 · 팔로우 · 차단 · 댓글 좋아요
-- ---------------------------------------------------------------------------
create table if not exists public.dopamine_user_profiles (
  uid text primary key,
  display_name text,
  photo_url text,
  updated_at timestamptz not null default now()
);
alter table public.dopamine_user_profiles enable row level security;

create table if not exists public.dopamine_user_follows (
  follower_uid text not null,
  following_uid text not null,
  created_at timestamptz not null default now(),
  primary key (follower_uid, following_uid),
  constraint dopamine_user_follows_no_self check (follower_uid <> following_uid)
);
alter table public.dopamine_user_follows enable row level security;

create index if not exists dopamine_user_follows_following_idx
  on public.dopamine_user_follows (following_uid);

create table if not exists public.dopamine_user_blocks (
  blocker_uid text not null,
  blocked_uid text not null,
  created_at timestamptz not null default now(),
  primary key (blocker_uid, blocked_uid),
  constraint dopamine_user_blocks_no_self check (blocker_uid <> blocked_uid)
);
alter table public.dopamine_user_blocks enable row level security;

create index if not exists dopamine_user_blocks_blocked_idx
  on public.dopamine_user_blocks (blocked_uid);

create table if not exists public.dopamine_comment_likes (
  comment_id uuid not null references public.dopamine_asset_comments (id) on delete cascade,
  user_uid text not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_uid)
);
alter table public.dopamine_comment_likes enable row level security;

create index if not exists dopamine_comment_likes_user_idx
  on public.dopamine_comment_likes (user_uid);

-- ---------------------------------------------------------------------------
-- 6) 신고 테이블 (초기)
-- ---------------------------------------------------------------------------
create table if not exists public.dopamine_comment_reports (
  comment_id uuid not null references public.dopamine_asset_comments (id) on delete cascade,
  reporter_uid text not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (comment_id, reporter_uid)
);

alter table public.dopamine_comment_reports enable row level security;

-- ---------------------------------------------------------------------------
-- 7) 신고 테이블 — 대시보드·AI용 스키마 (행 id, 스냅샷, FK 완화)
-- ---------------------------------------------------------------------------
alter table public.dopamine_comment_reports
  add column if not exists id uuid;

update public.dopamine_comment_reports set id = gen_random_uuid() where id is null;

alter table public.dopamine_comment_reports
  alter column id set default gen_random_uuid(),
  alter column id set not null;

alter table public.dopamine_comment_reports
  drop constraint if exists dopamine_comment_reports_pkey;

alter table public.dopamine_comment_reports
  add primary key (id);

create unique index if not exists dopamine_comment_reports_comment_reporter_uid_key
  on public.dopamine_comment_reports (comment_id, reporter_uid);

alter table public.dopamine_comment_reports
  drop constraint if exists dopamine_comment_reports_comment_id_fkey;

alter table public.dopamine_comment_reports
  alter column comment_id drop not null;

alter table public.dopamine_comment_reports
  add constraint dopamine_comment_reports_comment_id_fkey
  foreign key (comment_id) references public.dopamine_asset_comments (id)
  on delete set null;

alter table public.dopamine_comment_reports
  add column if not exists ai_verdict text,
  add column if not exists ai_reason text,
  add column if not exists ai_verdict_at timestamptz,
  add column if not exists admin_verdict text,
  add column if not exists admin_verdict_at timestamptz,
  add column if not exists comment_body_snapshot text,
  add column if not exists comment_title_snapshot text,
  add column if not exists target_author_uid text;

-- ---------------------------------------------------------------------------
-- 8) 급등·급락 요약 배치 (크론) — 선택
-- ---------------------------------------------------------------------------
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
    asset_class in ('us_stock', 'kr_stock', 'crypto', 'commodity', 'theme')
  ),
  constraint dopamine_move_summaries_unique unique (symbol, asset_class, summary_date)
);
alter table public.dopamine_asset_move_summaries enable row level security;

create index if not exists dopamine_move_summaries_lookup_idx
  on public.dopamine_asset_move_summaries (symbol, asset_class, summary_date desc);

-- ---------------------------------------------------------------------------
-- 9) 푸시 알림 (FCM 토큰·설정·일일 브리프 중복 방지)
-- ---------------------------------------------------------------------------
create table if not exists public.dopamine_device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  uid text not null,
  fcm_token text not null,
  platform text not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dopamine_push_tokens_platform check (
    platform in ('ios', 'android', 'web', 'unknown')
  ),
  constraint dopamine_push_tokens_uid_token unique (uid, fcm_token)
);

create index if not exists dopamine_push_tokens_uid_idx
  on public.dopamine_device_push_tokens (uid);

alter table public.dopamine_device_push_tokens enable row level security;

create table if not exists public.dopamine_user_push_prefs (
  uid text primary key,
  master_enabled boolean not null default true,
  social_reply boolean not null default true,
  social_like boolean not null default true,
  followed_new_post boolean not null default true,
  moderation_notice boolean not null default true,
  market_daily_brief boolean not null default true,
  market_watchlist boolean not null default true,
  market_theme boolean not null default true,
  quiet_start_minute smallint,
  quiet_end_minute smallint,
  updated_at timestamptz not null default now()
);

alter table public.dopamine_user_push_prefs enable row level security;

create table if not exists public.dopamine_market_daily_push_sent (
  uid text not null,
  day_utc date not null,
  sent_at timestamptz not null default now(),
  primary key (uid, day_utc)
);

create index if not exists dopamine_market_daily_push_sent_day_idx
  on public.dopamine_market_daily_push_sent (day_utc desc);

alter table public.dopamine_market_daily_push_sent enable row level security;

-- =============================================================================
-- 끝
-- =============================================================================

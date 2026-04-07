-- Supabase: 프로필 동기화, 팔로우, 댓글 좋아요
-- dopamine_asset_comments 가 있는 DB에 적용하세요.

create table if not exists public.dopamine_user_profiles (
  uid text primary key,
  display_name text,
  photo_url text,
  auth_email text,
  suspended_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.dopamine_user_profiles enable row level security;
alter table public.dopamine_user_profiles
  add column if not exists suspended_until timestamptz;

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

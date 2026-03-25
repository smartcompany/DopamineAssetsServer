-- Supabase: 프로필 동기화, 팔로우, 댓글 좋아요
-- dopamine_asset_comments 가 있는 DB에 적용하세요.

create table if not exists public.user_profiles (
  uid text primary key,
  display_name text,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_follows (
  follower_uid text not null,
  following_uid text not null,
  created_at timestamptz not null default now(),
  primary key (follower_uid, following_uid),
  constraint user_follows_no_self check (follower_uid <> following_uid)
);

create index if not exists user_follows_following_idx
  on public.user_follows (following_uid);

create table if not exists public.comment_likes (
  comment_id uuid not null references public.dopamine_asset_comments (id) on delete cascade,
  user_uid text not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_uid)
);

create index if not exists comment_likes_user_idx
  on public.comment_likes (user_uid);

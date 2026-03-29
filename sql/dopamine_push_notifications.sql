-- 푸시 알림 (FCM). apply_all_supabase.sql 9절과 동일 — 단독 적용용.

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

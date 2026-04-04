-- 푸시 알림 (FCM). apply_all_supabase.sql 9절과 동일 — 단독 적용용.

create table if not exists public.dopamine_device_push_tokens (
  uid text primary key,
  fcm_token text not null,
  platform text not null default 'unknown',
  locale text not null default 'ko',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dopamine_push_tokens_platform check (
    platform in ('ios', 'android', 'web', 'unknown')
  ),
  constraint dopamine_push_tokens_locale check (
    locale in ('ko', 'en')
  )
);

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
  hot_mover_discussion boolean not null default true,
  quiet_start_minute smallint,
  quiet_end_minute smallint,
  updated_at timestamptz not null default now()
);

alter table public.dopamine_user_push_prefs enable row level security;

create table if not exists public.dopamine_hot_mover_discussion_push_sent (
  bucket bigint not null,
  symbol text not null,
  asset_class text not null,
  root_comment_id uuid not null,
  sent_at timestamptz not null default now(),
  primary key (bucket, symbol, asset_class)
);

create index if not exists dopamine_hot_mover_discussion_push_sent_sent_at_idx
  on public.dopamine_hot_mover_discussion_push_sent (sent_at desc);

alter table public.dopamine_hot_mover_discussion_push_sent enable row level security;

alter table public.dopamine_asset_comments
  add column if not exists view_count integer not null default 0;

create table if not exists public.dopamine_hot_mover_discussion_config (
  id smallint primary key default 1 check (id = 1),
  use_time_window boolean not null default true,
  window_hours integer not null default 4
    constraint dopamine_hmdc_window_hours check (window_hours between 1 and 8760),
  min_thread_comments integer not null default 2
    constraint dopamine_hmdc_min_comments check (min_thread_comments between 0 and 500),
  min_root_view_count integer not null default 0
    constraint dopamine_hmdc_min_views check (min_root_view_count between 0 and 99999999),
  push_title_ko text not null default '🔥 지금 뜨는 토론',
  push_title_en text not null default '🔥 Heating up',
  push_body_template_ko text not null default $hmdc_body_ko$💬 {name} {direction} ({pct}) · 커뮤니티 온도 미쳤어요 👀 지금 보러 와요!$hmdc_body_ko$,
  push_body_template_en text not null default $hmdc_body_en$💬 {name} is {direction} ({pct}) — Community's buzzing 👀 Tap to see what's up!$hmdc_body_en$,
  updated_at timestamptz not null default now()
);

alter table public.dopamine_hot_mover_discussion_config enable row level security;

insert into public.dopamine_hot_mover_discussion_config (id) values (1)
on conflict (id) do nothing;

create table if not exists public.dopamine_market_daily_push_sent (
  uid text not null,
  day_utc date not null,
  sent_at timestamptz not null default now(),
  primary key (uid, day_utc)
);

create index if not exists dopamine_market_daily_push_sent_day_idx
  on public.dopamine_market_daily_push_sent (day_utc desc);

alter table public.dopamine_market_daily_push_sent enable row level security;

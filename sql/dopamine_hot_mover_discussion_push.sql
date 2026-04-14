-- 급등·급락 + 활발 토론 푸시 (4시간 크론). 기존 DB에만 적용 (신규는 apply_all_supabase.sql 반영).
-- dopamine_user_push_prefs 확장 + 전역 중복 방지.

alter table public.dopamine_user_push_prefs
  add column if not exists hot_mover_discussion boolean not null default true;

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

-- 루트 글 조회수 (푸시 조건·통계)
alter table public.dopamine_asset_comments
  add column if not exists view_count integer not null default 0;

comment on column public.dopamine_asset_comments.view_count is
  '루트 글(parent_id IS NULL) 기준 누적 조회(상세 진입 시 증가). 답글 행은 0 유지.';

-- 급등·급락 토론 푸시 조건 (대시보드에서 수정)
create table if not exists public.dopamine_hot_mover_discussion_config (
  id smallint primary key default 1 check (id = 1),
  use_time_window boolean not null default true,
  window_hours integer not null default 4
    constraint dopamine_hmdc_window_hours check (window_hours between 1 and 8760),
  min_thread_comments integer not null default 2
    constraint dopamine_hmdc_min_comments check (min_thread_comments between 0 and 500),
  min_root_view_count integer not null default 0
    constraint dopamine_hmdc_min_views check (min_root_view_count between 0 and 99999999),
  updated_at timestamptz not null default now()
);

alter table public.dopamine_hot_mover_discussion_config enable row level security;

insert into public.dopamine_hot_mover_discussion_config (id) values (1)
on conflict (id) do nothing;

-- 이미 1~500 제약으로 만들어 둔 DB: 0 허용으로 완화
alter table public.dopamine_hot_mover_discussion_config
  drop constraint if exists dopamine_hmdc_min_comments;
alter table public.dopamine_hot_mover_discussion_config
  add constraint dopamine_hmdc_min_comments check (min_thread_comments between 0 and 500);

-- 푸시 제목·본문 템플릿 (대시보드 편집, {name} {pct} {direction})
alter table public.dopamine_hot_mover_discussion_config
  add column if not exists push_title_ko text not null default '🔥 지금 뜨는 토론';
alter table public.dopamine_hot_mover_discussion_config
  add column if not exists push_title_en text not null default '🔥 Heating up';
alter table public.dopamine_hot_mover_discussion_config
  add column if not exists push_title_ja text not null default '🔥 今アツい討論';
alter table public.dopamine_hot_mover_discussion_config
  add column if not exists push_title_zh text not null default '🔥 正在热议';
alter table public.dopamine_hot_mover_discussion_config
  add column if not exists push_body_template_ko text not null default $hmdc_body_ko$💬 {name} {direction} ({pct}) · 커뮤니티 온도 미쳤어요 👀 지금 보러 와요!$hmdc_body_ko$;
alter table public.dopamine_hot_mover_discussion_config
  add column if not exists push_body_template_en text not null default $hmdc_body_en$💬 {name} is {direction} ({pct}) — Community's buzzing 👀 Tap to see what's up!$hmdc_body_en$;
alter table public.dopamine_hot_mover_discussion_config
  add column if not exists push_body_template_ja text not null default $hmdc_body_ja$💬 {name} が{direction}（{pct}）・コミュニティが大盛り上がり 👀 今すぐチェック！$hmdc_body_ja$;
alter table public.dopamine_hot_mover_discussion_config
  add column if not exists push_body_template_zh text not null default $hmdc_body_zh$💬 {name} {direction}（{pct}）· 社区热度爆表 👀 现在就来看看！$hmdc_body_zh$;

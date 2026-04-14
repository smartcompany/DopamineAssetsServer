-- Hot mover discussion push templates: add JA/ZH fields
alter table if exists public.dopamine_hot_mover_discussion_config
  add column if not exists push_title_ja text not null default '🔥 今アツい討論';

alter table if exists public.dopamine_hot_mover_discussion_config
  add column if not exists push_title_zh text not null default '🔥 正在热议';

alter table if exists public.dopamine_hot_mover_discussion_config
  add column if not exists push_body_template_ja text not null default $hmdc_body_ja$💬 {name} が{direction}（{pct}）・コミュニティが大盛り上がり 👀 今すぐチェック！$hmdc_body_ja$;

alter table if exists public.dopamine_hot_mover_discussion_config
  add column if not exists push_body_template_zh text not null default $hmdc_body_zh$💬 {name} {direction}（{pct}）· 社区热度爆表 👀 现在就来看看！$hmdc_body_zh$;

-- 신고 대시보드·AI 판정용 마이그레이션 (dopamine_comment_reports.sql 적용 후 실행)

-- 행 단위 id + 동일 글·동일 신고자 유일
ALTER TABLE public.dopamine_comment_reports
  ADD COLUMN IF NOT EXISTS id uuid;

UPDATE public.dopamine_comment_reports SET id = gen_random_uuid() WHERE id IS NULL;

ALTER TABLE public.dopamine_comment_reports
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN id SET NOT NULL;

ALTER TABLE public.dopamine_comment_reports
  DROP CONSTRAINT IF EXISTS dopamine_comment_reports_pkey;

ALTER TABLE public.dopamine_comment_reports
  ADD PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS dopamine_comment_reports_comment_reporter_uid_key
  ON public.dopamine_comment_reports (comment_id, reporter_uid);

-- 글 삭제 후에도 신고 이력 유지 (댓글 id 는 null)
ALTER TABLE public.dopamine_comment_reports
  DROP CONSTRAINT IF EXISTS dopamine_comment_reports_comment_id_fkey;

ALTER TABLE public.dopamine_comment_reports
  ALTER COLUMN comment_id DROP NOT NULL;

ALTER TABLE public.dopamine_comment_reports
  ADD CONSTRAINT dopamine_comment_reports_comment_id_fkey
  FOREIGN KEY (comment_id) REFERENCES public.dopamine_asset_comments (id)
  ON DELETE SET NULL;

ALTER TABLE public.dopamine_comment_reports
  ADD COLUMN IF NOT EXISTS ai_verdict text,
  ADD COLUMN IF NOT EXISTS ai_reason text,
  ADD COLUMN IF NOT EXISTS ai_verdict_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_verdict text,
  ADD COLUMN IF NOT EXISTS admin_verdict_at timestamptz,
  ADD COLUMN IF NOT EXISTS comment_body_snapshot text,
  ADD COLUMN IF NOT EXISTS comment_title_snapshot text,
  ADD COLUMN IF NOT EXISTS target_author_uid text;

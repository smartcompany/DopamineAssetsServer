-- 기존 DB: id uuid PK + unique(uid, fcm_token) → uid PK, uid당 FCM 토큰 1행.
-- 새 환경은 dopamine_push_notifications.sql / apply_all_supabase.sql 의 정의를 그대로 쓰면 됨.
-- 이 스크립트는 id 컬럼이 있을 때만 실행(이미 마이그레이션된 DB는 스킵).

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dopamine_device_push_tokens'
      AND column_name = 'id'
  ) THEN
  DELETE FROM public.dopamine_device_push_tokens d
  WHERE d.ctid IN (
    SELECT ctid
    FROM (
      SELECT
        ctid,
        ROW_NUMBER() OVER (
          PARTITION BY uid
          ORDER BY updated_at DESC NULLS LAST, id DESC NULLS LAST
        ) AS rn
      FROM public.dopamine_device_push_tokens
    ) sub
    WHERE sub.rn > 1
  );

  ALTER TABLE public.dopamine_device_push_tokens
    DROP CONSTRAINT IF EXISTS dopamine_push_tokens_uid_token;

  ALTER TABLE public.dopamine_device_push_tokens
    DROP CONSTRAINT IF EXISTS dopamine_device_push_tokens_pkey;

  ALTER TABLE public.dopamine_device_push_tokens
    DROP COLUMN id;

  ALTER TABLE public.dopamine_device_push_tokens
    ADD PRIMARY KEY (uid);

  DROP INDEX IF EXISTS public.dopamine_push_tokens_uid_idx;

  RAISE NOTICE 'dopamine_device_push_tokens: migrated to uid primary key';
  ELSE
    RAISE NOTICE 'dopamine_device_push_tokens: no id column, skip uid PK migration';
  END IF;
END;
$migration$;

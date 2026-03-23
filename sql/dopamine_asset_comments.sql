-- Supabase: 자산 상세 댓글 (스레드: parent_id)
-- 대시보드 SQL 에디터에서 실행하거나 `supabase db push` 등으로 적용하세요.
--
-- 필요한 서버 환경 변수 (Next API):
--   NEXT_PUBLIC_SUPABASE_URL
--   NEXT_PUBLIC_SUPABASE_KEY
--   Firebase Admin (댓글 POST 토큰 검증) — 택1:
--     FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=...
--     또는 FIREBASE_SERVICE_ACCOUNT_JSON=... (minify 한 줄; .env에 줄바꿈 넣지 말 것)

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
    asset_class in ('us_stock', 'kr_stock', 'crypto', 'commodity')
  )
);

create index if not exists dopamine_asset_comments_asset_idx
  on public.dopamine_asset_comments (asset_symbol, asset_class, created_at asc);

create index if not exists dopamine_asset_comments_parent_idx
  on public.dopamine_asset_comments (parent_id);

-- RLS: 클라이언트는 Supabase에 직접 붙지 않고 Next API(서비스 롤)만 사용하는 전제라면
-- 테이블에 RLS를 켜고 정책을 비우면 anon 키로는 접근 불가입니다.
-- 서비스 롤 키는 RLS를 우회하므로 API 라우트에서만 사용하세요.

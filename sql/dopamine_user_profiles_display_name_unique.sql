-- 닉네임 정규화(lower(trim)) 기준 전역 유일. 동시 PATCH 로 인한 중복 저장 방지.
-- 이미 동일 정규화 닉네임이 2행 이상이면 인덱스 생성 전에 정리 필요.
create unique index if not exists dopamine_user_profiles_display_name_normalized_unique
  on public.dopamine_user_profiles (lower(trim(display_name)))
  where length(trim(coalesce(display_name, ''))) > 0;

comment on index public.dopamine_user_profiles_display_name_normalized_unique is
  '표시 닉네임 중복 방지(API 선조회 + DB 최종 방어). 빈 닉네임은 여러 행 허용.';

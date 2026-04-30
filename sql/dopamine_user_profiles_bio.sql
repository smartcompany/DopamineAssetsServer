alter table public.dopamine_user_profiles
  add column if not exists bio text;

comment on column public.dopamine_user_profiles.bio is
  'Optional self-introduction; max length enforced in API.';

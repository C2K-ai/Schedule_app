-- ════════════════════════════════════════════════════════════════════
--  MUST 플래너 — 서버 함수 설정을 Vault 에서 읽기
--
--  Edge Function 비밀값(VAPID 키·크론 비밀·버튼 서명키)을 CLI(`supabase secrets set`) 없이
--  SQL 만으로 넣을 수 있게 한다. 함수는 환경변수를 먼저 보고, 없으면 이 함수로 Vault 를 읽는다.
--
--  값 넣기 (SQL Editor, `npm run vapid` 출력 그대로):
--    select vault.create_secret('<VAPID 공개키>',  'must_vapid_public');
--    select vault.create_secret('<VAPID 개인키>',  'must_vapid_private');
--    select vault.create_secret('mailto:you@example.com', 'must_vapid_subject');
--    select vault.create_secret('<CRON 비밀값>',   'must_cron_secret');
--    select vault.create_secret('<버튼 서명키>',   'must_action_secret');
--    select vault.create_secret('https://<프로젝트ID>.supabase.co', 'must_project_url');
-- ════════════════════════════════════════════════════════════════════
create or replace function public.must_function_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(s.name, s.decrypted_secret), '{}'::jsonb)
    from vault.decrypted_secrets s
   where s.name in ('must_vapid_public', 'must_vapid_private', 'must_vapid_subject',
                    'must_cron_secret', 'must_action_secret', 'must_project_url');
$$;

-- 서비스 롤(Edge Function)만 호출 가능. 앱 사용자·익명은 못 읽는다.
revoke all on function public.must_function_config() from public, anon, authenticated;
grant execute on function public.must_function_config() to service_role;

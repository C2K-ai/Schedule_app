-- 음성·문장으로 일정 넣기(parse-schedule) — Claude API 키를 Vault 에서 읽을 수 있게 설정 목록에 추가.
-- 키 넣기(Supabase 대시보드 → SQL Editor, 한 번만):
--    select vault.create_secret('sk-ant-...', 'must_anthropic_key');
-- 바꿀 때:
--    select vault.update_secret((select id from vault.secrets where name = 'must_anthropic_key'), 'sk-ant-새키');
-- (또는 Edge Functions → Secrets 에 ANTHROPIC_API_KEY 로 넣어도 된다 — 그쪽이 우선)
create or replace function public.must_function_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(s.name, s.decrypted_secret), '{}'::jsonb)
    from vault.decrypted_secrets s
   where s.name in ('must_vapid_public', 'must_vapid_private', 'must_vapid_subject',
                    'must_cron_secret', 'must_action_secret', 'must_project_url',
                    'must_anthropic_key');
$$;

revoke all on function public.must_function_config() from public, anon, authenticated;
grant execute on function public.must_function_config() to service_role;

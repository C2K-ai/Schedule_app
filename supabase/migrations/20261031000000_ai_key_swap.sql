-- ════════════════════════════════════════════════════════════════════
--  DREAM — 관리자 화면에서 Claude API 키 바꾸기 (2026-10-31)
--   Anthropic 키에 만료가 생겼다(예: 만든 날부터 30일). 만료되면 AI 기능(말로·Write·사진·커리어)이 모두 멈춘다.
--   새 키를 관리자 화면에 붙여 넣으면 Edge `ai-key` 가 먼저 Anthropic 에 아주 짧게 시험해 보고, 맞을 때만
--   Vault(must_anthropic_key)에 넣는다 — 키가 채팅·문서·로그를 거치지 않는다.
--   두 함수 모두 service role(Edge)만 부를 수 있다. 키 값은 돌려주지 않고 알아보기용 앞 16·뒤 4글자만.
--  다시 돌려도 안전.
-- ════════════════════════════════════════════════════════════════════

-- 지금 키 알아보기 — 'sk-ant-api03-Abc…wxyz' 처럼(콘솔의 키 목록과 맞춰 볼 수 있게), 언제 넣었는지
create or replace function public.must_ai_key_hint() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object(
        'exists', true,
        'hint', left(d.decrypted_secret, 16) || '…' || right(d.decrypted_secret, 4),
        'updated_at', d.updated_at)
       from vault.decrypted_secrets d
      where d.name = 'must_anthropic_key' and coalesce(d.decrypted_secret, '') <> ''
      limit 1),
    jsonb_build_object('exists', false));
$$;

-- 새 키 넣기(있으면 바꾸고, 없으면 만든다) — 시험은 Edge 가 먼저 한다. 모양만 여기서 한 번 더 본다
create or replace function public.must_set_ai_key(p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  -- (Postgres 정규식은 반복 횟수를 255 까지만 받아 길이는 따로 본다)
  if p_key is null or char_length(p_key) not between 30 and 300 or p_key !~ '^sk-ant-[A-Za-z0-9_-]+$' then
    raise exception 'bad_key: Claude API 키 모양이 아니에요' using errcode = '22023';
  end if;
  select d.id into v_id from vault.decrypted_secrets d where d.name = 'must_anthropic_key' limit 1;
  if v_id is null then
    perform vault.create_secret(p_key, 'must_anthropic_key', 'Claude API 키 — DREAM AI(관리자 화면에서 바꿈)');
  else
    perform vault.update_secret(v_id, p_key);
  end if;
  return public.must_ai_key_hint();
end $$;

revoke all on function public.must_ai_key_hint() from public, anon, authenticated;
revoke all on function public.must_set_ai_key(text) from public, anon, authenticated;
grant execute on function public.must_ai_key_hint() to service_role;
grant execute on function public.must_set_ai_key(text) to service_role;

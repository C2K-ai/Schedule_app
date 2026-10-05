-- ════════════════════════════════════════════════════════════════════
--  MUST 플래너 — 1인 전용 모드
--
--  저장소가 공개라 앱에 들어 있는 공개 키(anon/publishable)도 누구나 볼 수 있다.
--  혼자 쓰는 동안은 첫 가입자 한 명만 받고 그 뒤 가입은 막는다.
--  (각 사용자 데이터는 RLS 로 이미 분리돼 있지만, 남이 내 무료 한도를 쓰는 걸 막기 위해)
--
--  여러 명이 쓰게 되면 이 줄 하나로 풀면 된다:
--    drop trigger if exists must_single_owner on auth.users;
-- ════════════════════════════════════════════════════════════════════
create or replace function public.must_single_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from auth.users) then
    raise exception 'MUST: 1인 전용 서버라 새 가입을 받지 않습니다' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke all on function public.must_single_owner() from public, anon, authenticated;

drop trigger if exists must_single_owner on auth.users;
create trigger must_single_owner before insert on auth.users
  for each row execute function public.must_single_owner();

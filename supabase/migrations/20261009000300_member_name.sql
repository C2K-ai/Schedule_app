-- ════════════════════════════════════════════════════════════════════
--  DREAM — 가입 신청 때 이름 받기
--   · 가입 신청(Edge Function `signup`)이 이름을 user_metadata.name 에 넣으면 트리거가 must_members.name 으로 옮긴다.
--     관리자 화면·가입 신청 알림에 이름이 보여서 누군지 보고 승인할 수 있다.
--  다시 돌려도 안전.
-- ════════════════════════════════════════════════════════════════════

alter table public.must_members add column if not exists name text check (char_length(name) <= 40);

create or replace function public.must_new_member() returns trigger
language plpgsql security definer set search_path = '' as $$
declare first boolean := not exists (select 1 from auth.users u where u.id <> new.id);
begin
  insert into public.must_members (user_id, approved, approved_at, name)
  values (new.id, first, case when first then now() end,
          nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), 40), ''))
  on conflict do nothing;
  return new;
end $$;
revoke all on function public.must_new_member() from public, anon, authenticated;

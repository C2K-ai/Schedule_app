-- ════════════════════════════════════════════════════════════════════
--  DREAM — 가입 승인
--   · must_members : 사용자마다 '승인됨/승인 대기'. 첫 사용자(주인)와 이미 있던 사용자는 승인됨,
--                    그 뒤로 가입한 사람은 관리자가 관리자 화면에서 승인해야 앱을 쓸 수 있다.
--   · 승인 대기 중에는 AI 를 못 쓴다(비용). 앱은 must_my_access() 로 '승인 대기' 화면을 보인다.
--   · 가입 신청은 Edge Function `signup` 이 받는다(메일 확인 없이 계정을 만들고 관리자에게 푸시).
--  다시 돌려도 안전.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.must_members (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  approved     boolean not null default false,
  requested_at timestamptz not null default now(),
  approved_at  timestamptz,
  approved_by  uuid
);
create index if not exists must_members_pending on public.must_members (requested_at) where not approved;
-- 정책 없음: 앱은 직접 못 읽고 못 쓴다. 내 상태는 must_my_access() 로만, 승인은 Edge Function `admin` 으로만.
alter table public.must_members enable row level security;
revoke all on public.must_members from anon, authenticated;

-- 이미 있는 사용자는 모두 승인된 것으로
insert into public.must_members (user_id, approved, requested_at, approved_at)
select u.id, true, u.created_at, now() from auth.users u
on conflict do nothing;

-- 새 사용자: 아무도 없던 서버의 첫 사용자(주인)는 바로 승인, 그 밖에는 승인 대기
create or replace function public.must_new_member() returns trigger
language plpgsql security definer set search_path = '' as $$
declare first boolean := not exists (select 1 from auth.users u where u.id <> new.id);
begin
  insert into public.must_members (user_id, approved, approved_at)
  values (new.id, first, case when first then now() end)
  on conflict do nothing;
  return new;
end $$;
revoke all on function public.must_new_member() from public, anon, authenticated;
create or replace trigger must_new_member after insert on auth.users
  for each row execute function public.must_new_member();

-- 내가 앱을 쓸 수 있는지 — 관리자는 늘 승인됨. 기록이 없으면(만들어지기 전 사용자) 승인 대기로 본다
create or replace function public.must_my_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'approved', exists (select 1 from public.must_admins a where a.user_id = (select auth.uid()))
             or coalesce((select m.approved from public.must_members m where m.user_id = (select auth.uid())), false),
    'admin', exists (select 1 from public.must_admins a where a.user_id = (select auth.uid())),
    'requested_at', (select m.requested_at from public.must_members m where m.user_id = (select auth.uid()))
  );
$$;
revoke all on function public.must_my_access() from public, anon;
grant execute on function public.must_my_access() to authenticated;

-- AI 한도 예약 — 승인 대기 중이면 한도 0(비용이 새지 않게). 나머지는 20261008000400_admin.sql 과 같다
create or replace function public.must_ai_claim(p_user uuid, p_fn text, p_model text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean;
  v_limit int;
  v_used  int;
  v_id    bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('must_ai:' || p_user::text, 0));
  v_admin := exists (select 1 from public.must_admins a where a.user_id = p_user);
  if not v_admin and not coalesce((select m.approved from public.must_members m where m.user_id = p_user), false) then
    return jsonb_build_object('ok', false, 'used', 0, 'limit', 0, 'admin', false, 'pending', true);
  end if;
  v_limit := coalesce((select s.ai_daily_limit from public.must_app_settings s where s.id), 30);
  select count(*) into v_used from public.ai_usage u
   where u.user_id = p_user
     and u.created_at >= ((now() at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul');
  if not v_admin and v_used >= v_limit then
    return jsonb_build_object('ok', false, 'used', v_used, 'limit', v_limit, 'admin', false);
  end if;
  insert into public.ai_usage (user_id, fn, model) values (p_user, p_fn, p_model) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'used', v_used + 1, 'limit', v_limit, 'admin', v_admin);
end $$;
revoke all on function public.must_ai_claim(uuid, text, text) from public, anon, authenticated;
grant execute on function public.must_ai_claim(uuid, text, text) to service_role;

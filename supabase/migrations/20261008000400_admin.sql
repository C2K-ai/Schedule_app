-- ════════════════════════════════════════════════════════════════════
--  MUST 플래너 — 운영자(관리자) 화면
--   · must_admins       : 관리자 목록. 처음 가입한 사람(주인)이 자동으로 관리자가 된다.
--   · must_app_settings : 새 가입 받기(기본 꺼짐 = 1인 전용) · 한 사람의 하루 AI 사용 한도
--   · ai_usage          : AI 호출 기록(토큰 수) — 비용 확인과 하루 한도에 쓴다
--   · must_admin_*()    : 관리자 화면용 통계·작업. 서비스 롤(Edge Function `admin`)만 부를 수 있고,
--                         그 함수가 부른 사람이 관리자인지 먼저 확인한다.
--  다시 돌려도 안전.
-- ════════════════════════════════════════════════════════════════════

-- ───────────── 관리자 ─────────────
create table if not exists public.must_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
-- 정책 없음: 앱(anon·authenticated)은 직접 못 읽고 못 쓴다. 관리자 여부는 must_is_admin() 으로만.
alter table public.must_admins enable row level security;
revoke all on public.must_admins from anon, authenticated;

-- 관리자가 아무도 없을 때만 가장 먼저 가입한 사람(주인)을 관리자로
insert into public.must_admins (user_id)
select u.id from auth.users u
 where not exists (select 1 from public.must_admins)
 order by u.created_at
 limit 1
on conflict do nothing;

-- 서버를 새로 만든 경우: 첫 가입자가 관리자(다른 사용자가 이미 있으면 절대 자동으로 관리자가 되지 않는다)
create or replace function public.must_first_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from auth.users u where u.id <> new.id)
     and not exists (select 1 from public.must_admins) then
    insert into public.must_admins (user_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function public.must_first_admin() from public, anon, authenticated;
create or replace trigger must_first_admin after insert on auth.users
  for each row execute function public.must_first_admin();

-- 앱 메뉴에 '관리자'를 보일지 — 내가 관리자인지만 알려 준다
create or replace function public.must_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.must_admins a where a.user_id = (select auth.uid()));
$$;
revoke all on function public.must_is_admin() from public, anon;
grant execute on function public.must_is_admin() to authenticated;

-- ───────────── 앱 전체 설정(한 줄) ─────────────
create table if not exists public.must_app_settings (
  id             boolean primary key default true check (id),
  signups_open   boolean not null default false,
  ai_daily_limit int not null default 30 check (ai_daily_limit between 0 and 1000),
  updated_at     timestamptz not null default now()
);
alter table public.must_app_settings enable row level security;
revoke all on public.must_app_settings from anon, authenticated;
insert into public.must_app_settings (id) values (true) on conflict do nothing;

-- 1인 전용 잠금이 이 설정을 따른다(가입 받기를 켜면 누구나 가입 가능)
create or replace function public.must_single_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from auth.users)
     and not coalesce((select s.signups_open from public.must_app_settings s where s.id), false) then
    raise exception 'MUST: 지금은 새 가입을 받지 않습니다' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.must_single_owner() from public, anon, authenticated;

-- 로그인 화면이 '처음이에요(가입)' 탭을 보일지 — 아직 아무도 없거나 가입을 열어 둔 때만
create or replace function public.must_signups_open() returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from auth.users)
      or coalesce((select s.signups_open from public.must_app_settings s where s.id), false);
$$;
revoke all on function public.must_signups_open() from public;
grant execute on function public.must_signups_open() to anon, authenticated;

-- ───────────── AI 사용 기록 ─────────────
create table if not exists public.ai_usage (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  fn            text not null,
  model         text not null,
  input_tokens  int  not null default 0 check (input_tokens >= 0),
  output_tokens int  not null default 0 check (output_tokens >= 0),
  created_at    timestamptz not null default now()
);
create index if not exists ai_usage_user_time on public.ai_usage (user_id, created_at);
create index if not exists ai_usage_time on public.ai_usage (created_at);
alter table public.ai_usage enable row level security;
-- 내 기록은 읽을 수 있다(쓰기 정책이 없으니 앱은 못 쓴다 — Edge Function 만)
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_usage' and policyname = 'read own ai usage') then
    create policy "read own ai usage" on public.ai_usage for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end $$;

-- AI 를 부르기 직전에 한 칸 예약 — 한도 확인과 기록을 한 번에(동시에 여러 번 눌러도 한도를 못 넘는다).
-- '오늘'은 한국 시간 자정부터. 사용자가 바꿀 수 있는 프로필 시간대는 쓰지 않는다(한도를 되돌리는 구멍이 됨).
-- 돌려주는 값: {ok, id?, used, limit, admin}. ok=false 면 오늘 한도를 다 쓴 것.
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
  -- 승인 대기 중이면 한도 0 (must_members 는 20261009000000_approval.sql — 다시 돌려도 그 동작이 유지되게 같은 내용)
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

-- 프로필 시간대는 앱이 마음대로 쓸 수 있는 칸 — 이상한 값이면 서울로 되돌린다
-- (습관 회차·브리핑 크론이 모든 사용자의 시간대로 계산하므로, 잘못된 값 하나가 전체를 멈추지 않게)
create or replace function public.must_valid_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  begin
    perform now() at time zone new.timezone;
  exception when others then
    new.timezone := 'Asia/Seoul';
  end;
  return new;
end $$;
revoke all on function public.must_valid_timezone() from public, anon, authenticated;
create or replace trigger profiles_valid_tz before insert or update of timezone on public.profiles
  for each row execute function public.must_valid_timezone();

-- ───────────── 관리자 화면: 개요 ─────────────
create or replace function public.must_admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  today  timestamptz := (now() at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul';
  month0 timestamptz := date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  jobs   jsonb := '[]'::jsonb;
begin
  -- pg_cron 이 있는 서버에서만(테스트 DB 엔 없음)
  if to_regclass('cron.job') is not null then
    execute $q$
      with r as (
        select d.jobid, d.status, d.start_time
          from cron.job_run_details d
         where d.start_time > now() - interval '1 day'
      ), agg as (
        select r.jobid,
               count(*) filter (where r.status <> 'succeeded') as fails,
               (array_agg(r.status order by r.start_time desc))[1] as last_status,
               max(r.start_time) as last_at
          from r group by r.jobid
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
               'last_status', a.last_status, 'last_at', a.last_at, 'fails_24h', coalesce(a.fails, 0)
             ) order by j.jobid), '[]'::jsonb)
        from cron.job j
        left join agg a on a.jobid = j.jobid
    $q$ into jobs;
  end if;

  return jsonb_build_object(
    'now', now(),
    'users', (select count(*) from auth.users),
    'users_week', (select count(*) from auth.users u where u.created_at > now() - interval '7 days'),
    -- 활동 = 로그인했거나 세션이 갱신됨(앱을 열어 둔 동안 1시간마다). 서버가 만든 습관 일정은 세지 않는다
    'active_week', (
      select count(*) from auth.users u
       where u.last_sign_in_at > now() - interval '7 days'
          or exists (select 1 from auth.sessions s
                      where s.user_id = u.id
                        and greatest(s.updated_at, s.refreshed_at at time zone 'UTC') > now() - interval '7 days')),
    'settings', (select to_jsonb(s) - 'id' from public.must_app_settings s where s.id),
    'ai_today', (select count(*) from public.ai_usage a where a.created_at >= today),
    'ai_month', (
      select coalesce(jsonb_agg(jsonb_build_object('model', m.model, 'calls', m.calls, 'input', m.input, 'output', m.output)), '[]'::jsonb)
        from (select a.model, count(*) as calls, sum(a.input_tokens) as input, sum(a.output_tokens) as output
                from public.ai_usage a where a.created_at >= month0 group by a.model) m),
    'devices', (select count(*) from public.push_subscriptions),
    'pushes_today', (select count(*) from public.notification_jobs n where n.sent_at >= today),
    'push_errors_24h', (select count(*) from public.notification_jobs n
                         where n.last_error is not null and n.fire_at > now() - interval '1 day'),
    'cron', jobs
  );
end $$;
revoke all on function public.must_admin_overview() from public, anon, authenticated;
grant execute on function public.must_admin_overview() to service_role;

-- ───────────── 관리자 화면: 사용자 목록 ─────────────
create or replace function public.must_admin_users()
returns table (
  id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, last_active_at timestamptz,
  banned_until timestamptz, provider text, confirmed boolean, is_admin boolean,
  tasks int, tasks_done int, habits int, study_sec bigint, career int, devices int, sessions int,
  ai_today int, ai_month_calls int, ai_month_input bigint, ai_month_output bigint, ai_month_models jsonb
)
language sql stable security definer set search_path = '' as $$
  with b as (
    select (now() at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul' as today,
           date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as month0
  )
  select u.id,
         u.email::text,
         u.created_at,
         u.last_sign_in_at,
         greatest(
           u.last_sign_in_at,
           (select max(greatest(s.updated_at, s.refreshed_at at time zone 'UTC')) from auth.sessions s where s.user_id = u.id)
         ),
         u.banned_until,
         coalesce(u.raw_app_meta_data ->> 'provider', 'email'),
         u.email_confirmed_at is not null,
         exists (select 1 from public.must_admins a where a.user_id = u.id),
         (select count(*) from public.tasks t where t.user_id = u.id and t.deleted_at is null)::int,
         (select count(*) from public.tasks t where t.user_id = u.id and t.deleted_at is null and t.status = 'done')::int,
         (select count(*) from public.habits h where h.user_id = u.id and h.deleted_at is null)::int,
         (select coalesce(sum(extract(epoch from
                   least(coalesce(ss.ended_at, now()), ss.started_at + interval '16 hours') - ss.started_at)), 0)
            from public.study_sessions ss where ss.user_id = u.id and ss.deleted_at is null)::bigint,
         (select count(*) from public.career_entries c where c.user_id = u.id and c.deleted_at is null)::int,
         (select count(*) from public.push_subscriptions p where p.user_id = u.id)::int,
         (select count(*) from auth.sessions s where s.user_id = u.id and (s.not_after is null or s.not_after > now()))::int,
         (select count(*) from public.ai_usage a where a.user_id = u.id and a.created_at >= b.today)::int,
         (select count(*) from public.ai_usage a where a.user_id = u.id and a.created_at >= b.month0)::int,
         (select coalesce(sum(a.input_tokens), 0) from public.ai_usage a where a.user_id = u.id and a.created_at >= b.month0)::bigint,
         (select coalesce(sum(a.output_tokens), 0) from public.ai_usage a where a.user_id = u.id and a.created_at >= b.month0)::bigint,
         (select coalesce(jsonb_agg(jsonb_build_object('model', m.model, 'input', m.input, 'output', m.output)), '[]'::jsonb)
            from (select a.model, sum(a.input_tokens) as input, sum(a.output_tokens) as output
                    from public.ai_usage a where a.user_id = u.id and a.created_at >= b.month0 group by a.model) m)
    from auth.users u, b
   order by u.created_at;
$$;
revoke all on function public.must_admin_users() from public, anon, authenticated;
grant execute on function public.must_admin_users() to service_role;

-- 모든 기기에서 로그아웃 — 로그인 세션을 지금 만료시키고 갱신 토큰을 무효로 한다.
-- 이미 받은 접속 토큰은 길어야 1시간 뒤 끊긴다.
create or replace function public.must_admin_signout(p_user uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update auth.sessions s set not_after = now()
   where s.user_id = p_user and (s.not_after is null or s.not_after > now());
  get diagnostics n = row_count;
  update auth.refresh_tokens r set revoked = true
   where r.user_id = p_user::text and not coalesce(r.revoked, false);
  return n;
end $$;
revoke all on function public.must_admin_signout(uuid) from public, anon, authenticated;
grant execute on function public.must_admin_signout(uuid) to service_role;

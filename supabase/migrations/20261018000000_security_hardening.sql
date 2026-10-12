-- ════════════════════════════════════════════════════════════════════
--  DREAM — 보안 점검(2026-10-11) 반영
--   1. ai_usage: 앱 역할(anon·authenticated)의 쓰기 권한을 거둔다(RLS 로 이미 막혀 있었지만 권한 자체도 정리) — 읽기만
--   2. 드라이브 용량: 앱이 알려 주는 크기만 믿지 않고 실제로 저장된 바이트(storage.objects metadata.size)로 센다.
--      표 줄 없이 남은 파일도 센다. 저장 파일이 올라오거나 바뀔 때 용량을 넘으면 거절(트리거).
--   3. 반복(습관) 시각: '25:00' 같은 값을 막고, 서버 회차 만들기는 이상한 줄을 건너뛴다(한 사람 때문에 모두 멈추지 않게)
--   4. 시간대: 이름이 있는 시간대(Asia/Seoul 등)만 — 'UTC+3' 같은 값은 알림 함수(Intl)가 못 읽어 그 묶음이 멈췄다
--   5. 푸시 구독: 알려진 푸시 서버 주소만, 한 사람 20개까지(아무 주소나 넣어 알림 발송을 붙잡지 못하게)
--   6. 알림 꺼내기: 한 사람 한 번(1분)에 10건까지 — 일정을 잔뜩 만들어 다른 사람 알림을 밀어내지 못하게
--   7. 캘린더 구독 주소: 살아 있는 로그인에서만 만들고 바꿈 — '모든 기기 로그아웃' 뒤 남은 접속 토큰(최대 1시간)으로 새 주소를 못 만들게
--   8. 일정·반복 하나의 알림은 10개까지 — 알림 작업을 잔뜩 만들어 매분 발송을 무겁게 하지 못하게
--  지우는 문 없이, 다시 돌려도 안전.
-- ════════════════════════════════════════════════════════════════════

-- ───────────── 1. ai_usage 권한 ─────────────
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;

-- ───────────── 2. 드라이브: 실제 바이트로 용량 세기 ─────────────
-- 사람 하나의 사용량 = 표 줄마다 max(적힌 크기, 실제 파일 크기) + 표 줄 없이 남은 파일. p_except = 고쳐 쓰는 중인 파일(빼고 셈)
create or replace function public.must_drive_used(p_user uuid, p_except uuid default null) returns bigint
language sql stable security definer set search_path = '' as $$
  select
    coalesce((
      select sum(greatest(f.size, case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint else 0 end))
        from public.drive_files f
        left join storage.objects o on o.bucket_id = 'drive' and o.name = f.user_id::text || '/' || f.id::text
       where f.user_id = p_user and f.id is distinct from p_except
    ), 0)
    + coalesce((
      select sum(case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint else 0 end)
        from storage.objects o
       where o.bucket_id = 'drive' and (storage.foldername(o.name))[1] = p_user::text
         and not exists (select 1 from public.drive_files f where f.user_id::text || '/' || f.id::text = o.name)
    ), 0);
$$;
revoke all on function public.must_drive_used(uuid, uuid) from public, anon, authenticated;

create or replace function public.must_drive_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_quota bigint;
  v_used  bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('must_drive:' || new.user_id::text, 0));
  if not exists (select 1 from public.must_admins a where a.user_id = new.user_id)
     and not coalesce((select m.approved from public.must_members m where m.user_id = new.user_id), false) then
    raise exception 'drive_pending: 승인 후에 쓸 수 있어요' using errcode = 'P0001';
  end if;
  v_quota := coalesce((select s.drive_quota_mb from public.must_app_settings s where s.id), 150)::bigint * 1048576;
  v_used := public.must_drive_used(new.user_id);
  if v_used + new.size > v_quota then
    raise exception 'drive_quota: 드라이브 용량이 모자라요' using errcode = 'P0001',
      detail = json_build_object('used', v_used, 'quota', v_quota)::text;
  end if;
  return new;
end $$;
revoke all on function public.must_drive_quota() from public, anon, authenticated;

create or replace function public.must_drive_usage() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'used', public.must_drive_used((select auth.uid())),
    'files', (select count(*) from public.drive_files f where f.user_id = (select auth.uid()) and f.ready),
    'quota', coalesce((select s.drive_quota_mb from public.must_app_settings s where s.id), 150)::bigint * 1048576,
    'max_file', 52428800
  );
$$;
revoke all on function public.must_drive_usage() from public, anon;
grant execute on function public.must_drive_usage() to authenticated;

create or replace function public.must_admin_drive()
returns table (user_id uuid, files int, bytes bigint)
language sql stable security definer set search_path = '' as $$
  select f.user_id, count(*)::int, public.must_drive_used(f.user_id)
    from public.drive_files f group by f.user_id;
$$;
revoke all on function public.must_admin_drive() from public, anon, authenticated;
grant execute on function public.must_admin_drive() to service_role;

-- 고쳐 쓰기(공부 노트): 늘어날 때만 용량 확인 — 다른 파일들의 '실제' 사용량 기준
create or replace function public.must_drive_rewrite(p_id uuid, p_size bigint, p_expected timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_old   bigint;
  v_at    timestamptz;
  v_quota bigint;
  v_used  bigint;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_size is null or p_size < 0 or p_size > 52428800 then
    raise exception 'drive_size: 파일 하나는 50MB 까지' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('must_drive:' || v_uid::text, 0));
  select f.size, f.updated_at into v_old, v_at from public.drive_files f where f.id = p_id and f.user_id = v_uid for update;
  if not found then
    raise exception 'drive_missing: 파일이 없어요' using errcode = 'P0002';
  end if;
  if p_expected is not null and v_at is distinct from p_expected then
    raise exception 'drive_conflict: 다른 기기에서 먼저 고쳤어요' using errcode = 'P0001';
  end if;
  if p_size > v_old then
    if not exists (select 1 from public.must_admins a where a.user_id = v_uid)
       and not coalesce((select m.approved from public.must_members m where m.user_id = v_uid), false) then
      raise exception 'drive_pending: 승인 후에 쓸 수 있어요' using errcode = 'P0001';
    end if;
    v_quota := coalesce((select s.drive_quota_mb from public.must_app_settings s where s.id), 150)::bigint * 1048576;
    v_used := public.must_drive_used(v_uid, p_id);
    if v_used + p_size > v_quota then
      raise exception 'drive_quota: 드라이브 용량이 모자라요' using errcode = 'P0001',
        detail = json_build_object('used', v_used, 'quota', v_quota)::text;
    end if;
  end if;
  update public.drive_files set size = p_size where id = p_id;
  return jsonb_build_object('size', p_size, 'updated_at', v_at);
end $$;
revoke all on function public.must_drive_rewrite(uuid, bigint, timestamptz) from public, anon;
grant execute on function public.must_drive_rewrite(uuid, bigint, timestamptz) to authenticated;

-- 저장 파일이 올라오거나 바뀔 때(크기가 알려진 뒤) 실제 사용량이 용량을 넘으면 거절 — 앱이 크기를 속여도 여기서 막힌다
create or replace function public.must_drive_object_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner text := (storage.foldername(new.name))[1];
  v_user  uuid;
  v_quota bigint;
  v_used  bigint;
begin
  if new.bucket_id <> 'drive' or v_owner !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  if not (new.metadata->>'size' ~ '^[0-9]{1,15}$') then
    return null; -- 크기를 아직 모름(올리는 중) — 크기가 적힐 때 다시 확인
  end if;
  -- 같은 파일을 같거나 작은 크기로 고쳐 쓰는 건 늘 됨(이미 용량을 넘었어도 노트를 줄여 저장할 수 있게)
  if tg_op = 'UPDATE' and old.metadata->>'size' ~ '^[0-9]{1,15}$'
     and (new.metadata->>'size')::bigint <= (old.metadata->>'size')::bigint then
    return null;
  end if;
  v_user := v_owner::uuid;
  perform pg_advisory_xact_lock(hashtextextended('must_drive:' || v_user::text, 0));
  v_quota := coalesce((select s.drive_quota_mb from public.must_app_settings s where s.id), 150)::bigint * 1048576;
  v_used := public.must_drive_used(v_user);
  if v_used > v_quota then
    raise exception 'drive_quota: 드라이브 용량이 모자라요' using errcode = 'P0001',
      detail = json_build_object('used', v_used, 'quota', v_quota)::text;
  end if;
  return null;
end $$;
revoke all on function public.must_drive_object_guard() from public, anon, authenticated;
create or replace trigger must_drive_object_guard after insert or update of metadata on storage.objects
  for each row execute function public.must_drive_object_guard();

-- ───────────── 3. 반복 시각 ─────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'habits_start_time_valid') then
    alter table public.habits
      add constraint habits_start_time_valid check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') not valid;
    alter table public.habits validate constraint habits_start_time_valid;
  end if;
end $$;

-- 습관 → 오늘·내일 회차 생성(기간 안에서만, 시간표 칸은 빼고 — 20261017 과 같음). 시각이 이상한 줄은 건너뛴다(한 줄 때문에 모두의 회차가 멈추지 않게)
create or replace function public.materialize_habits(p_user uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into tasks (id, user_id, habit_id, occurrence_date, title, color, starts_at, ends_at,
                     reminder_offsets, sound_id, "strict", created_at, updated_at)
  select
    (left(replace(h.id::text, '-', ''), 24) || to_char(d.day, 'YYYYMMDD'))::uuid,
    h.user_id, h.id, d.day, h.title, h.color,
    (d.day + h.start_time::time) at time zone p.timezone,
    ((d.day + h.start_time::time) at time zone p.timezone) + make_interval(mins => h.duration_min),
    h.reminder_offsets, h.sound_id, h."strict",
    now(),
    'epoch'::timestamptz          -- 자동 생성 회차는 '아주 오래된' 수정 시각 → 사람이 고친 값이 항상 이긴다
  from habits h
  join profiles p on p.id = h.user_id
  cross join lateral (
    select ((now() at time zone p.timezone)::date + g) as day from generate_series(0, 1) g
  ) d
  where h.active and h.deleted_at is null
    and not coalesce(h.in_timetable, false)
    and h.start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and extract(dow from d.day)::int = any (h.days)
    and d.day >= (h.created_at at time zone p.timezone)::date
    and ((d.day + h.start_time::time) at time zone p.timezone) >= h.created_at
    and (h.start_day is null or d.day >= h.start_day)
    and (h.end_day is null or d.day <= h.end_day)
    and (p_user is null or h.user_id = p_user)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.materialize_habits(uuid) from public, anon, authenticated;
grant execute on function public.materialize_habits(uuid) to service_role;

-- ───────────── 4. 시간대 ─────────────
-- 'Asia/Seoul'·'America/Argentina/Buenos_Aires'·'Etc/GMT+3'·'UTC' 꼴만 + Postgres 가 읽을 수 있어야 함. 'UTC+3'·'<X>-9' 같은 POSIX 꼴은 서울로.
-- (pg_timezone_names 를 뒤지면 한 번에 0.1~0.8초 — 프로필 저장마다 부담이라 쓰지 않음. 안 바뀌면 검사하지 않음)
create or replace function public.must_valid_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.timezone is not distinct from old.timezone then
    return new;
  end if;
  if new.timezone is null or not (new.timezone = 'UTC' or new.timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){1,2}$') then
    new.timezone := 'Asia/Seoul';
    return new;
  end if;
  begin
    perform now() at time zone new.timezone;
  exception when others then
    new.timezone := 'Asia/Seoul';
  end;
  return new;
end $$;
revoke all on function public.must_valid_timezone() from public, anon, authenticated;

-- ───────────── 5. 푸시 구독 ─────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'push_subscriptions_endpoint_host') then
    alter table public.push_subscriptions add constraint push_subscriptions_endpoint_host check (
      endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com)/'
    ) not valid;
    alter table public.push_subscriptions validate constraint push_subscriptions_endpoint_host;
  end if;
end $$;

create or replace function public.must_push_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('must_push:' || new.user_id::text, 0));
  -- 이미 있는 주소를 다시 저장(앱의 upsert)하는 건 새 기기가 아니다
  if exists (select 1 from public.push_subscriptions s where s.endpoint = new.endpoint) then
    return new;
  end if;
  if (select count(*) from public.push_subscriptions s where s.user_id = new.user_id) >= 20 then
    raise exception 'push_limit: 알림 받는 기기가 너무 많아요' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.must_push_limit() from public, anon, authenticated;
create or replace trigger push_subscriptions_limit before insert on public.push_subscriptions
  for each row execute function public.must_push_limit();

-- ───────────── 6. 알림 꺼내기 — 한 사람 한 번에 10건까지 ─────────────
create or replace function public.claim_due_notification_jobs(p_limit int default 200)
returns setof public.notification_jobs
language sql security definer set search_path = public as $$
  update notification_jobs j
     set claimed_at = now(), attempts = j.attempts + 1
   where j.id in (
     select n.id from notification_jobs n
      where n.id in (
        select x.id from (
          select c.id, c.fire_at, row_number() over (partition by c.user_id order by c.fire_at, c.id) as rn
            from notification_jobs c
           where c.sent_at is null
             and c.fire_at <= now()
             and c.fire_at >  now() - interval '30 minutes'        -- 너무 늦은 알림은 보내지 않음
             and c.attempts < 5
             and (c.claimed_at is null or c.claimed_at < now() - interval '2 minutes')
        ) x
        where x.rn <= 10
        order by x.fire_at
        limit p_limit)
        and (n.claimed_at is null or n.claimed_at < now() - interval '2 minutes')
      for update skip locked)
  returning j.*;
$$;
revoke all on function public.claim_due_notification_jobs(int) from public, anon, authenticated;
grant execute on function public.claim_due_notification_jobs(int) to service_role;

-- ───────────── 7. 캘린더 구독 주소 — 살아 있는 로그인에서만 ─────────────
-- 접속 토큰(JWT)은 로그아웃해도 만료(최대 1시간)까지 쓸 수 있어, 세션이 아직 살아 있는지 auth.sessions 로 확인한다
create or replace function public.must_session_alive() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.sessions s
     where s.id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id')::uuid
       and s.user_id = (select auth.uid())
       and (s.not_after is null or s.not_after > now())
  );
$$;
revoke all on function public.must_session_alive() from public, anon;
grant execute on function public.must_session_alive() to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calendar_feeds' and policyname = 'feed needs live session (insert)') then
    create policy "feed needs live session (insert)" on public.calendar_feeds as restrictive for insert to authenticated
      with check (public.must_session_alive());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calendar_feeds' and policyname = 'feed needs live session (update)') then
    create policy "feed needs live session (update)" on public.calendar_feeds as restrictive for update to authenticated
      using (public.must_session_alive()) with check (public.must_session_alive());
  end if;
end $$;

-- ───────────── 8. 일정·반복 하나의 알림 10개까지 ─────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_reminders_max') then
    alter table public.tasks add constraint tasks_reminders_max check (cardinality(reminder_offsets) <= 10) not valid;
    alter table public.tasks validate constraint tasks_reminders_max;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'habits_reminders_max') then
    alter table public.habits add constraint habits_reminders_max check (cardinality(reminder_offsets) <= 10) not valid;
    alter table public.habits validate constraint habits_reminders_max;
  end if;
end $$;

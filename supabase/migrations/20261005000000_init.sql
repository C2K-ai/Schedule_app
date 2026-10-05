-- ════════════════════════════════════════════════════════════════════
--  MUST 플래너 — 스키마
--  Supabase SQL Editor 에 통째로 붙여 실행하거나 `npx supabase db push`
-- ════════════════════════════════════════════════════════════════════
--  설계 요점
--   • 모든 행은 클라이언트가 만든 UUID 를 쓴다 → 오프라인에서 만들고 나중에 올려도 충돌 없음
--   • updated_at = 클라이언트 시계. 더 오래된 쓰기는 lww_guard 가 조용히 버린다(Last-Write-Wins)
--   • synced_at  = 서버 시계. 클라이언트의 '변경분만 받기' 커서
--   • 삭제는 deleted_at(soft delete) — Realtime 으로 삭제도 그대로 전파된다
--   • task_logs(미룬·건너뛴 사유)는 쓰기만 되고 고치거나 지울 수 없다
--   • notification_jobs 는 tasks 트리거가 자동으로 채우고, pg_cron 이 1분마다 꺼내 푸시한다
-- ════════════════════════════════════════════════════════════════════

-- ───────────── 프로필(설정) ─────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  timezone    text        not null default 'Asia/Seoul',
  grace_min   int         not null default 5 check (grace_min between 0 and 120),
  settings    jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  synced_at   timestamptz not null default now()
);

-- ───────────── 습관(반복 템플릿) ─────────────
create table if not exists public.habits (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title            text not null check (char_length(title) between 1 and 200),
  color            text not null default 'violet',
  days             smallint[] not null default '{1,2,3,4,5}',        -- 0=일 … 6=토
  start_time       text not null check (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'), -- 'HH:MM' 현지 시각
  duration_min     int  not null check (duration_min between 5 and 1440),
  reminder_offsets int[] not null default '{10,0}',
  sound_id         text,
  strict           boolean not null default true,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  synced_at        timestamptz not null default now()
);
create index if not exists habits_user_synced on public.habits (user_id, synced_at);

-- ───────────── 일정 ─────────────
create table if not exists public.tasks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  habit_id         uuid references public.habits (id) on delete set null,
  occurrence_date  date,
  title            text not null check (char_length(title) between 1 and 200),
  notes            text check (notes is null or char_length(notes) <= 5000),
  color            text not null default 'lime',
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           text not null default 'planned'
                   check (status in ('planned', 'in_progress', 'done', 'skipped', 'missed')),
  started_at       timestamptz,
  completed_at     timestamptz,
  reminder_offsets int[] not null default '{10,0}',                  -- 시작 몇 분 전, 0 = 정각
  sound_id         text,
  strict           boolean not null default true,                    -- 강제 모드
  postpone_count   int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  synced_at        timestamptz not null default now(),
  constraint tasks_time_order check (ends_at > starts_at)
);
create unique index if not exists tasks_habit_occurrence on public.tasks (habit_id, occurrence_date) where habit_id is not null;
create index if not exists tasks_user_start  on public.tasks (user_id, starts_at);
create index if not exists tasks_user_synced on public.tasks (user_id, synced_at);

-- ───────────── 사유 기록(변명 노트) — 지울 수 없음 ─────────────
create table if not exists public.task_logs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id         uuid references public.tasks (id) on delete set null,
  kind            text not null check (kind in ('started', 'completed', 'postponed', 'skipped', 'missed',
                                                'reopened', 'focus_done', 'focus_abandoned')),
  reason          text check (reason is null or char_length(reason) <= 2000),
  from_starts_at  timestamptz,
  to_starts_at    timestamptz,
  title           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  synced_at       timestamptz not null default now()
);
create index if not exists task_logs_user_created on public.task_logs (user_id, created_at desc);
create index if not exists task_logs_user_synced  on public.task_logs (user_id, synced_at);

-- ───────────── 집중(뽀모도로) 세션 ─────────────
create table if not exists public.focus_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id         uuid references public.tasks (id) on delete set null,
  mode            text not null check (mode in ('focus', 'break')),
  started_at      timestamptz not null,
  planned_end     timestamptz not null,
  paused_at       timestamptz,
  ended_at        timestamptz,
  completed       boolean not null default false,
  abandon_reason  text,
  cycle           int not null default 1,
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  synced_at       timestamptz not null default now()
);
create index if not exists focus_user_synced on public.focus_sessions (user_id, synced_at);

-- ───────────── Web Push 구독(기기마다 하나) ─────────────
create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists push_user on public.push_subscriptions (user_id);

-- ───────────── 보낼 알림 큐 ─────────────
create table if not exists public.notification_jobs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  task_id     uuid not null references public.tasks (id) on delete cascade,
  kind        text not null check (kind in ('before', 'start', 'overdue', 'snooze')),
  seq         int  not null,           -- before/start: 몇 분 전, overdue: 1·2·3번째, snooze: n번째
  fire_at     timestamptz not null,
  claimed_at  timestamptz,
  sent_at     timestamptz,
  attempts    int not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  unique (task_id, kind, seq, fire_at)
);
create index if not exists notification_jobs_due on public.notification_jobs (fire_at) where sent_at is null;

-- ════════════════════════════════════════════════════════════════════
--  트리거
-- ════════════════════════════════════════════════════════════════════

-- LWW: 더 오래된 updated_at 으로 덮어쓰려 하면 무시. synced_at 은 서버 시계로 갱신.
create or replace function public.lww_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.updated_at < old.updated_at then
      return null;                       -- 오래된(오프라인에서 늦게 올라온) 쓰기 → 버림
    end if;
    if tg_table_name <> 'profiles' then
      new.user_id := old.user_id;        -- 소유자는 바뀌지 않는다
    end if;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists profiles_lww on public.profiles;
create trigger profiles_lww before insert or update on public.profiles for each row execute function public.lww_guard();
drop trigger if exists habits_lww on public.habits;
create trigger habits_lww before insert or update on public.habits for each row execute function public.lww_guard();
drop trigger if exists tasks_lww on public.tasks;
create trigger tasks_lww before insert or update on public.tasks for each row execute function public.lww_guard();
drop trigger if exists task_logs_lww on public.task_logs;
create trigger task_logs_lww before insert or update on public.task_logs for each row execute function public.lww_guard();
drop trigger if exists focus_lww on public.focus_sessions;
create trigger focus_lww before insert or update on public.focus_sessions for each row execute function public.lww_guard();

-- 가입하면 프로필 자동 생성
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- 일정이 바뀔 때마다 보낼 알림을 다시 계산 (앱 src/lib/reminders.ts 와 같은 규칙)
--   before/start : reminder_offsets
--   overdue      : 강제 모드면 유예 직후, +10분, +25분 (세 번째부터는 끝난 뒤 30분 안까지만)
create or replace function public.sync_task_jobs() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_grace int;
  v_off   int;
  v_extra int;
  v_i     int := 0;
  v_fire  timestamptz;
begin
  if new.deleted_at is not null or new.status <> 'planned' then
    delete from notification_jobs where task_id = new.id and sent_at is null;
    return null;
  end if;

  delete from notification_jobs where task_id = new.id and sent_at is null and kind <> 'snooze';

  foreach v_off in array coalesce(new.reminder_offsets, '{}'::int[]) loop
    v_fire := new.starts_at - make_interval(mins => v_off);
    -- 만들기 전 시점·이미 지난 시점은 건너뜀(방금 만든 일정에 '10분 전' 알림이 바로 오는 것 방지)
    if v_fire >= new.created_at - interval '1 minute' and v_fire > now() - interval '1 minute' then
      insert into notification_jobs (user_id, task_id, kind, seq, fire_at)
      values (new.user_id, new.id, case when v_off > 0 then 'before' else 'start' end, v_off, v_fire)
      on conflict do nothing;
    end if;
  end loop;

  if new."strict" then
    select grace_min into v_grace from profiles where id = new.user_id;
    v_grace := coalesce(v_grace, 5);
    foreach v_extra in array array[0, 10, 25] loop
      v_i := v_i + 1;
      v_fire := new.starts_at + make_interval(mins => v_grace + v_extra);
      if (v_i = 1 or v_fire < new.ends_at + interval '30 minutes') and v_fire > now() - interval '1 minute' then
        insert into notification_jobs (user_id, task_id, kind, seq, fire_at)
        values (new.user_id, new.id, 'overdue', v_i, v_fire)
        on conflict do nothing;
      end if;
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists tasks_sync_jobs on public.tasks;
create trigger tasks_sync_jobs
  after insert or update of starts_at, ends_at, reminder_offsets, status, strict, deleted_at
  on public.tasks for each row execute function public.sync_task_jobs();

-- 유예 시간을 바꾸면 앞으로의 미시작 경고 시점도 다시 계산
create or replace function public.resync_after_grace_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.grace_min is distinct from old.grace_min then
    update tasks set "strict" = "strict"
     where user_id = new.id and status = 'planned' and deleted_at is null
       and starts_at > now() - interval '2 hours';
  end if;
  return null;
end $$;
drop trigger if exists profiles_grace_resync on public.profiles;
create trigger profiles_grace_resync after update of grace_min on public.profiles
  for each row execute function public.resync_after_grace_change();

-- ════════════════════════════════════════════════════════════════════
--  서버 함수
-- ════════════════════════════════════════════════════════════════════

-- 보낼 때가 된 알림을 가져가며 잠근다(크론이 겹쳐 돌아도 같은 알림을 두 번 보내지 않게)
create or replace function public.claim_due_notification_jobs(p_limit int default 200)
returns setof public.notification_jobs
language sql security definer set search_path = public as $$
  update notification_jobs j
     set claimed_at = now(), attempts = j.attempts + 1
   where j.id in (
     select id from notification_jobs
      where sent_at is null
        and fire_at <= now()
        and fire_at >  now() - interval '30 minutes'        -- 너무 늦은 알림은 보내지 않음
        and attempts < 5
        and (claimed_at is null or claimed_at < now() - interval '2 minutes')
      order by fire_at
      limit p_limit
      for update skip locked)
  returning j.*;
$$;
revoke all on function public.claim_due_notification_jobs(int) from public, anon, authenticated;
grant execute on function public.claim_due_notification_jobs(int) to service_role;

-- 습관 → 오늘·내일 회차 생성. 앱을 안 열어도 알림이 가도록 서버가 미리 만든다.
-- id 규칙은 앱의 habitInstanceId() 와 같다 → 앱이 먼저 만들어도 같은 행이 된다.
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
    and extract(dow from d.day)::int = any (h.days)
    and d.day >= (h.created_at at time zone p.timezone)::date
    and (p_user is null or h.user_id = p_user)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.materialize_habits(uuid) from public, anon, authenticated;
grant execute on function public.materialize_habits(uuid) to service_role;

-- ════════════════════════════════════════════════════════════════════
--  RLS — 자기 행만
-- ════════════════════════════════════════════════════════════════════
alter table public.profiles           enable row level security;
alter table public.habits             enable row level security;
alter table public.tasks              enable row level security;
alter table public.task_logs          enable row level security;
alter table public.focus_sessions     enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_jobs  enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "own habits" on public.habits;
create policy "own habits" on public.habits for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 사유 기록: 읽기·추가만. 수정·삭제 정책이 없으니 지울 수 없다.
drop policy if exists "read own logs" on public.task_logs;
create policy "read own logs" on public.task_logs for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "add own logs" on public.task_logs;
create policy "add own logs" on public.task_logs for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "own focus" on public.focus_sessions;
create policy "own focus" on public.focus_sessions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own push" on public.push_subscriptions;
create policy "own push" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "read own jobs" on public.notification_jobs;
create policy "read own jobs" on public.notification_jobs for select to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.profiles, public.habits, public.tasks,
  public.focus_sessions, public.push_subscriptions to authenticated;
grant select, insert on public.task_logs to authenticated;
grant select on public.notification_jobs to authenticated;
-- Supabase 는 새 테이블에 기본으로 모든 권한을 주므로, 막을 것은 명시적으로 회수한다
revoke update, delete on public.task_logs from anon, authenticated;
revoke insert, update, delete on public.notification_jobs from anon, authenticated;
revoke all on public.profiles, public.habits, public.tasks, public.task_logs, public.focus_sessions,
  public.push_subscriptions, public.notification_jobs from anon;

-- ════════════════════════════════════════════════════════════════════
--  Realtime — 노트북에서 바꾸면 핸드폰에 즉시
-- ════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['tasks', 'habits', 'task_logs', 'focus_sessions', 'profiles'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

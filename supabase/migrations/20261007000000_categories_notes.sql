-- ════════════════════════════════════════════════════════════════════
--  MUST 플래너 — 카테고리 · 별표 · 일정 종류 · 하루 노트 (2026-10-07 화면 개편)
-- ════════════════════════════════════════════════════════════════════

-- ───────────── 카테고리 ─────────────
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  color       text not null default 'violet',
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now()
);
create index if not exists categories_user_synced on public.categories (user_id, synced_at);

-- ───────────── 일정: 카테고리 · 별표 · 종류 ─────────────
--  schedule: timed = 시각 지정(알림·강제 대상) / day = 날짜만 / someday = 날짜 없음
alter table public.tasks
  add column if not exists category_id uuid references public.categories (id) on delete set null,
  add column if not exists starred     boolean not null default false,
  add column if not exists schedule    text    not null default 'timed';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_schedule_check') then
    alter table public.tasks add constraint tasks_schedule_check check (schedule in ('timed', 'day', 'someday'));
  end if;
end $$;
create index if not exists tasks_category on public.tasks (category_id);

-- ───────────── 하루 노트 ─────────────
create table if not exists public.day_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day         date not null,
  body        text not null default '' check (char_length(body) <= 20000),
  mood        smallint check (mood between 1 and 5),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now(),
  unique (user_id, day)
);
create index if not exists day_notes_user_synced on public.day_notes (user_id, synced_at);

-- LWW · synced_at
drop trigger if exists categories_lww on public.categories;
create trigger categories_lww before insert or update on public.categories for each row execute function public.lww_guard();
drop trigger if exists day_notes_lww on public.day_notes;
create trigger day_notes_lww before insert or update on public.day_notes for each row execute function public.lww_guard();

-- 알림은 시각 지정 일정에만 — 종류가 바뀌면 알림 큐도 다시 계산
create or replace function public.sync_task_jobs() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_grace int;
  v_off   int;
  v_extra int;
  v_i     int := 0;
  v_fire  timestamptz;
begin
  if new.deleted_at is not null or new.status <> 'planned' or coalesce(new.schedule, 'timed') <> 'timed' then
    delete from notification_jobs where task_id = new.id and sent_at is null;
    return null;
  end if;

  delete from notification_jobs where task_id = new.id and sent_at is null and kind <> 'snooze';

  foreach v_off in array coalesce(new.reminder_offsets, '{}'::int[]) loop
    v_fire := new.starts_at - make_interval(mins => v_off);
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
revoke all on function public.sync_task_jobs() from public, anon, authenticated;

drop trigger if exists tasks_sync_jobs on public.tasks;
create trigger tasks_sync_jobs
  after insert or update of starts_at, ends_at, reminder_offsets, status, strict, deleted_at, schedule
  on public.tasks for each row execute function public.sync_task_jobs();

-- RLS
alter table public.categories enable row level security;
alter table public.day_notes  enable row level security;
drop policy if exists "own categories" on public.categories;
create policy "own categories" on public.categories for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own day notes" on public.day_notes;
create policy "own day notes" on public.day_notes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.categories, public.day_notes to authenticated;
revoke all on public.categories, public.day_notes from anon;

-- Realtime
do $$
declare t text;
begin
  foreach t in array array['categories', 'day_notes'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

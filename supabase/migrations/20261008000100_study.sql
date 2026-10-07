-- ════════════════════════════════════════════════════════════════════
--  MUST 플래너 — 공부 타이머(열품타 방식): 과목 · 공부 기록
--   과목별 스톱워치를 켜고 끄면 구간 하나가 study_sessions 한 행.
--   ended_at 이 비어 있으면 지금 재는 중(다른 기기에서도 실시간으로 보인다).
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.subjects (
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
create index if not exists subjects_user_synced on public.subjects (user_id, synced_at);

create table if not exists public.study_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id  uuid references public.subjects (id) on delete set null,
  task_id     uuid references public.tasks (id) on delete set null,
  started_at  timestamptz not null,
  ended_at    timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists study_sessions_user_synced on public.study_sessions (user_id, synced_at);
create index if not exists study_sessions_user_started on public.study_sessions (user_id, started_at);

create or replace trigger subjects_lww before insert or update on public.subjects for each row execute function public.lww_guard();
create or replace trigger study_sessions_lww before insert or update on public.study_sessions for each row execute function public.lww_guard();

alter table public.subjects       enable row level security;
alter table public.study_sessions enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subjects' and policyname = 'own subjects') then
    create policy "own subjects" on public.subjects for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'study_sessions' and policyname = 'own study sessions') then
    create policy "own study sessions" on public.study_sessions for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;
grant select, insert, update, delete on public.subjects, public.study_sessions to authenticated;
revoke all on public.subjects, public.study_sessions from anon;

do $$
declare t text;
begin
  foreach t in array array['subjects', 'study_sessions'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

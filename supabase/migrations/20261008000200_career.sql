-- ════════════════════════════════════════════════════════════════════
--  MUST 플래너 — 커리어 기록
--   나중에 이력서·포트폴리오를 쓸 때 꺼내 보려고 남기는 기록.
--   raw = 사용자가 대충 적은 것, polished = AI 가 다듬은 문장(사용자가 고칠 수 있음)
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.career_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  kind        text not null default 'work'
              check (kind in ('work', 'project', 'study', 'cert', 'award', 'activity', 'etc')),
  start_day   date not null,
  end_day     date,
  raw         text not null default '' check (char_length(raw) <= 20000),
  polished    text not null default '' check (char_length(polished) <= 20000),
  skills      text[] not null default '{}',
  task_ids    uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now(),
  check (end_day is null or end_day >= start_day)
);
create index if not exists career_entries_user_synced on public.career_entries (user_id, synced_at);

drop trigger if exists career_entries_lww on public.career_entries;
create trigger career_entries_lww before insert or update on public.career_entries for each row execute function public.lww_guard();

alter table public.career_entries enable row level security;
drop policy if exists "own career" on public.career_entries;
create policy "own career" on public.career_entries for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.career_entries to authenticated;
revoke all on public.career_entries from anon;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'career_entries'
  ) then
    alter publication supabase_realtime add table public.career_entries;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════
--  DREAM 플래너 — 한 일 기록
--   일정(계획)과 따로, 이미 한 일만 남기는 기록. 알림·강제 모드·사유서·'놓침' 이 없다.
--   day = 그날(현지 날짜). 시각은 넣어도 되고(starts_at·ends_at 둘 다) 안 넣어도 된다.
--  다시 돌려도 안전(DROP 없음).
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.activities (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  notes        text check (notes is null or char_length(notes) <= 5000),
  day          date not null,
  starts_at    timestamptz,
  ends_at      timestamptz,
  color        text not null default 'cyan',
  category_id  uuid references public.categories (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  synced_at    timestamptz not null default now(),
  check ((starts_at is null) = (ends_at is null)),
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists activities_user_synced on public.activities (user_id, synced_at);
create index if not exists activities_user_day on public.activities (user_id, day);
create index if not exists activities_category on public.activities (category_id);

create or replace trigger activities_lww before insert or update on public.activities for each row execute function public.lww_guard();

alter table public.activities enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'activities' and policyname = 'own activities') then
    create policy "own activities" on public.activities for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;
grant select, insert, update, delete on public.activities to authenticated;
revoke all on public.activities from anon;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activities'
  ) then
    alter publication supabase_realtime add table public.activities;
  end if;
end $$;

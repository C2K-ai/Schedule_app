-- ════════════════════════════════════════════════════════════════════
--  DREAM 플래너 — 표시(생일·기념일·시험·여행처럼 날짜만 있는 표시)
--   일정(할 일)도 한 일 기록도 아닌 것: 체크·알림·강제·'했나요?'·사유서가 없다. 캘린더에 날짜 표시만.
--   day = 시작 날(현지), end_day = 여러 날이면 마지막 날(포함), yearly = 매년 같은 날(생일·기념일, 하루짜리만).
--  다시 돌려도 안전(DROP 없음).
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.marks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  notes       text check (notes is null or char_length(notes) <= 5000),
  day         date not null,
  end_day     date check (end_day is null or end_day >= day),
  yearly      boolean not null default false,
  emoji       text check (emoji is null or char_length(emoji) <= 8),
  color       text not null default 'pink',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now(),
  check (not (yearly and end_day is not null))
);
create index if not exists marks_user_synced on public.marks (user_id, synced_at);
create index if not exists marks_user_day on public.marks (user_id, day);

create or replace trigger marks_lww before insert or update on public.marks for each row execute function public.lww_guard();

alter table public.marks enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'marks' and policyname = 'own marks') then
    create policy "own marks" on public.marks for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;
grant select, insert, update, delete on public.marks to authenticated;
revoke all on public.marks from anon;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'marks'
  ) then
    alter publication supabase_realtime add table public.marks;
  end if;
end $$;

-- 구글 캘린더 등에서 DREAM 일정을 '구독'해 보는 비밀 주소(ICS). 한 사람에 하나.
--   Edge `calendar-feed`(JWT 없이 ?token= 으로)가 service role 로 이 표에서 주인을 찾아 일정을 내준다.
--   앱은 자기 행만 만들고·바꾸고(새 주소)·지운다(끄기). 다시 돌려도 안전하게(if not exists).
create table if not exists public.calendar_feeds (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{32,128}$'),
  created_at timestamptz not null default now()
);

alter table public.calendar_feeds enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calendar_feeds' and policyname = 'own calendar feed') then
    create policy "own calendar feed" on public.calendar_feeds for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

revoke all on public.calendar_feeds from anon;
grant select, insert, update, delete on public.calendar_feeds to authenticated;

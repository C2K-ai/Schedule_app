-- ════════════════════════════════════════════════════════════════════
--  MUST 플래너 — 기기별 아침 브리핑 푸시
--   폰은 기본 10:00, 노트북은 끔(노트북은 앱을 켤 때 브리핑). 사용자 시간대 기준 하루 한 번.
--   1분 크론(send-due-notifications)이 claim_due_briefings() 로 꺼내 보낸다.
-- ════════════════════════════════════════════════════════════════════

alter table public.push_subscriptions
  add column if not exists device_name     text,
  add column if not exists briefing_time   text,
  add column if not exists last_briefing_on date;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'push_subscriptions_briefing_time_check') then
    alter table public.push_subscriptions add constraint push_subscriptions_briefing_time_check
      check (briefing_time is null or briefing_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
end $$;

-- 보낼 때가 된 브리핑을 꺼내며 '오늘 보냄'으로 표시 — 크론이 겹쳐 돌아도 한 번만.
-- 정한 시각부터 3시간 안에만 보낸다(서버가 오래 멈췄다 살아나도 저녁에 아침 브리핑이 가지 않게).
create or replace function public.claim_due_briefings()
returns table (
  id uuid, user_id uuid, endpoint text, p256dh text, auth text,
  tz text, local_day date, day_start timestamptz, day_end timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with ready as (
    select s.id as sid, coalesce(p.timezone, 'Asia/Seoul') as ztz,
           (now() at time zone coalesce(p.timezone, 'Asia/Seoul'))::date as ld,
           (now() at time zone coalesce(p.timezone, 'Asia/Seoul'))::time as lt,
           s.briefing_time::time as bt
      from public.push_subscriptions s
      left join public.profiles p on p.id = s.user_id
     where s.briefing_time is not null
  )
  update public.push_subscriptions s
     set last_briefing_on = r.ld
    from ready r
   where s.id = r.sid
     and r.lt >= r.bt
     and r.lt < r.bt + interval '3 hours'
     and r.bt < time '21:00'
     and (s.last_briefing_on is null or s.last_briefing_on < r.ld)
  returning s.id, s.user_id, s.endpoint, s.p256dh, s.auth, r.ztz, r.ld,
            (r.ld::timestamp at time zone r.ztz), ((r.ld + 1)::timestamp at time zone r.ztz);
end $$;
revoke all on function public.claim_due_briefings() from public, anon, authenticated;
grant execute on function public.claim_due_briefings() to service_role;

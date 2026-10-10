-- ════════════════════════════════════════════════════════════════════
--  DREAM — 반복(습관)에 시작·끝 날짜
--   · "이번 달 매일 운동"처럼 기간이 있는 반복: start_day ~ end_day 사이만 회차를 만든다(둘 다 없으면 예전처럼 계속).
--   · 서버가 미리 만드는 회차(materialize_habits, 오늘·내일)도 그 기간을 지킨다.
--   · 습관을 만들기 전에 이미 지난 회차(오후에 넣은 '매일 아침 7시'의 오늘 7시)는 만들지 않는다 — 앱과 같은 규칙.
--  다시 돌려도 안전.
-- ════════════════════════════════════════════════════════════════════

alter table public.habits add column if not exists start_day date;
alter table public.habits add column if not exists end_day date;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'habits_day_range_check') then
    alter table public.habits
      add constraint habits_day_range_check check (start_day is null or end_day is null or end_day >= start_day);
  end if;
end $$;

-- 습관 → 오늘·내일 회차 생성(기간 안에서만). id 규칙은 앱의 habitInstanceId() 와 같다.
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

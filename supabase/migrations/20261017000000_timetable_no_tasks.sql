-- ════════════════════════════════════════════════════════════════════
--  DREAM — 시간표 수업은 일정(회차)을 만들지 않는다(사용자: "시간표는 시간표 — 수강계획을 일정으로 넣지 마")
--   · materialize_habits: in_timetable 인 반복은 건너뛴다.
--   · 이미 만들어진 수업 회차는 지운 표시(deleted_at)만 — 되돌릴 수 있게. 앱도 같은 일을 한다(dropClassOccurrences).
--  다시 돌려도 안전.
-- ════════════════════════════════════════════════════════════════════

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

-- 이미 만들어진 수업 회차 정리(지운 표시만)
update public.tasks t
   set deleted_at = now(), updated_at = now()
  from public.habits h
 where t.habit_id = h.id
   and coalesce(h.in_timetable, false)
   and t.deleted_at is null;

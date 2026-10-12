-- ════════════════════════════════════════════════════════════════════
--  DREAM — 시간표
--   · in_timetable: 이 반복(습관)을 캘린더 '시간표' 보기에 보인다(수업·알바·동아리).
--     null 도 받는다(= 안 보임) — 앱이 옛 행과 새 행을 한 번에 올리면 빠진 칸이 null 로 와도 묶음이 거절되지 않게.
--   · place: 강의실·장소(시간표 칸에 같이 보임), 60자까지.
--   학기 = 수업들의 start_day ~ end_day(20261013000000_habit_range). 다시 돌려도 안전.
-- ════════════════════════════════════════════════════════════════════

alter table public.habits add column if not exists in_timetable boolean default false;
alter table public.habits add column if not exists place text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'habits_place_len_check') then
    alter table public.habits add constraint habits_place_len_check check (place is null or char_length(place) <= 60);
  end if;
end $$;

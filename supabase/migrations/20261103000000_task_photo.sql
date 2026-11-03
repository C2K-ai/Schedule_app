-- ════════════════════════════════════════════════════════════════════
--  DREAM — 일정에 사진 한 장 (2026-11-03)
--   '택배 갖고 오기'처럼 일정에 사진을 붙인다. 사진은 드라이브('일정 사진' 폴더)에 올리고, 일정에는 그 파일 id(photo_id)만.
--   · 내 드라이브 파일만 붙는다 — 남의 파일·없는 파일 id 면 비운다(바뀔 때만 확인).
--   · 드라이브에서 그 사진을 지우면 일정의 photo_id 도 비운다(다른 기기도 받아 가게 updated_at 도 올림).
--  다시 돌려도 안전.
-- ════════════════════════════════════════════════════════════════════

alter table public.tasks add column if not exists photo_id uuid;

create or replace function public.must_task_photo_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.photo_id is not null
     and (tg_op = 'INSERT' or new.photo_id is distinct from old.photo_id)
     and not exists (select 1 from public.drive_files f where f.id = new.photo_id and f.user_id = new.user_id) then
    new.photo_id := null;
  end if;
  return new;
end $$;
revoke all on function public.must_task_photo_owner() from public, anon, authenticated;
create or replace trigger tasks_photo_owner before insert or update of photo_id on public.tasks
  for each row execute function public.must_task_photo_owner();

-- 드라이브 파일이 없어지면 그 사진을 쓰던 일정에서 뺀다
create or replace function public.must_task_photo_gone() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.tasks set photo_id = null, updated_at = now()
   where photo_id = old.id and user_id = old.user_id;
  return old;
end $$;
revoke all on function public.must_task_photo_gone() from public, anon, authenticated;
create or replace trigger drive_files_task_photo after delete on public.drive_files
  for each row execute function public.must_task_photo_gone();

-- ════════════════════════════════════════════════════════════════════
--  DREAM — 드라이브 폴더(공부 노트 'Study') + 같은 파일 고쳐 쓰기
--   · drive_files.folder: 폴더 이름(비어 있으면 맨 위). 지금은 앱이 'Study'(공부 노트)만 만든다.
--   · must_drive_resize(id, size): 노트를 고쳐 같은 자리에 다시 올릴 때 크기를 바꾼다.
--     크기는 앱이 직접 못 고친다(용량 속이기 막기) — 이 함수가 올릴 때와 같은 기준으로 용량을 확인한다.
--  다시 돌려도 안전.
-- ════════════════════════════════════════════════════════════════════

alter table public.drive_files add column if not exists folder text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'drive_files_folder_check') then
    alter table public.drive_files
      add constraint drive_files_folder_check check (folder is null or char_length(folder) between 1 and 60);
  end if;
end $$;
create index if not exists drive_files_folder on public.drive_files (user_id, folder, updated_at desc);

grant insert (id, filename, size, mime, starred, locked, folder) on public.drive_files to authenticated;
grant update (filename, starred, ready, updated_at, folder) on public.drive_files to authenticated;

-- 같은 파일을 새 내용으로 덮어쓸 때 — 커지면 용량 확인(줄어드는 건 늘 됨), 내 파일만
create or replace function public.must_drive_resize(p_id uuid, p_size bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_old   bigint;
  v_quota bigint;
  v_used  bigint;
  v_at    timestamptz := now();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_size is null or p_size < 0 or p_size > 52428800 then
    raise exception 'drive_size: 파일 하나는 50MB 까지' using errcode = '22023';
  end if;
  -- 올리기(must_drive_quota)와 같은 잠금 — 동시에 여러 개 고쳐도 한도를 못 넘게
  perform pg_advisory_xact_lock(hashtextextended('must_drive:' || v_uid::text, 0));
  select f.size into v_old from public.drive_files f where f.id = p_id and f.user_id = v_uid for update;
  if not found then
    raise exception 'drive_missing: 파일이 없어요' using errcode = 'P0002';
  end if;
  if p_size > v_old then
    if not exists (select 1 from public.must_admins a where a.user_id = v_uid)
       and not coalesce((select m.approved from public.must_members m where m.user_id = v_uid), false) then
      raise exception 'drive_pending: 승인 후에 쓸 수 있어요' using errcode = 'P0001';
    end if;
    v_quota := coalesce((select s.drive_quota_mb from public.must_app_settings s where s.id), 150)::bigint * 1048576;
    select coalesce(sum(f.size), 0) into v_used from public.drive_files f where f.user_id = v_uid and f.id <> p_id;
    if v_used + p_size > v_quota then
      raise exception 'drive_quota: 드라이브 용량이 모자라요' using errcode = 'P0001',
        detail = json_build_object('used', v_used, 'quota', v_quota)::text;
    end if;
  end if;
  update public.drive_files set size = p_size, updated_at = v_at where id = p_id;
  return jsonb_build_object('size', p_size, 'updated_at', v_at);
end $$;
revoke all on function public.must_drive_resize(uuid, bigint) from public, anon;
grant execute on function public.must_drive_resize(uuid, bigint) to authenticated;

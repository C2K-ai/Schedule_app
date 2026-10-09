-- ════════════════════════════════════════════════════════════════════
--  DREAM — 공부 노트 덮어쓰기 v2
--   · must_drive_rewrite(id, size, expected): 같은 파일을 새 내용으로 덮어쓰기 전에 부른다.
--     - expected(그 노트를 고치기 시작한 판의 updated_at)가 지금과 다르면 'drive_conflict' — 다른 기기가 그새 고쳤다는 뜻.
--     - 크기만 바꾸고 updated_at 은 안 건드린다. 시각은 내용을 다 올린 뒤에 앱이 바꾼다 —
--       올리다 끊겨도 '다른 기기에서 고침'처럼 보이지 않게(가짜 충돌 사본이 생기던 문제).
--     - 커지면 용량 확인(올리기와 같은 기준·같은 잠금), 줄어드는 건 늘 됨.
--   · must_drive_resize(id, size)(v1)는 시각을 바꿔서 위 문제가 있었다 → 판 확인 없이 v2 를 부르게 바꿔 둔다.
--  다시 돌려도 안전.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.must_drive_rewrite(p_id uuid, p_size bigint, p_expected timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_old   bigint;
  v_at    timestamptz;
  v_quota bigint;
  v_used  bigint;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_size is null or p_size < 0 or p_size > 52428800 then
    raise exception 'drive_size: 파일 하나는 50MB 까지' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('must_drive:' || v_uid::text, 0));
  select f.size, f.updated_at into v_old, v_at from public.drive_files f where f.id = p_id and f.user_id = v_uid for update;
  if not found then
    raise exception 'drive_missing: 파일이 없어요' using errcode = 'P0002';
  end if;
  if p_expected is not null and v_at is distinct from p_expected then
    raise exception 'drive_conflict: 다른 기기에서 먼저 고쳤어요' using errcode = 'P0001';
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
  update public.drive_files set size = p_size where id = p_id;
  return jsonb_build_object('size', p_size, 'updated_at', v_at);
end $$;
revoke all on function public.must_drive_rewrite(uuid, bigint, timestamptz) from public, anon;
grant execute on function public.must_drive_rewrite(uuid, bigint, timestamptz) to authenticated;

-- v1 은 이제 판 확인 없이 v2 를 부른다(시각을 안 바꿈)
create or replace function public.must_drive_resize(p_id uuid, p_size bigint) returns jsonb
language sql security definer set search_path = '' as $$
  select public.must_drive_rewrite(p_id, p_size, null);
$$;
revoke all on function public.must_drive_resize(uuid, bigint) from public, anon;
grant execute on function public.must_drive_resize(uuid, bigint) to authenticated;

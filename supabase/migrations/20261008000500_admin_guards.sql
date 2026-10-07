-- ════════════════════════════════════════════════════════════════════
--  MUST 플래너 — 관리자 보호 · 크론 기록 정리 (20261008000400_admin 다음)
--   · 마지막 관리자는 빠지지 않는다 — 두 관리자가 동시에 서로를 빼거나, 대시보드에서
--     관리자 계정을 지워도 최소 한 명은 남는다(그 작업이 오류로 멈춘다).
--   · 1분마다 도는 알림 크론의 실행 기록이 하루 1,440줄씩 쌓인다 — 매일 새벽 정리에 7일 지난 기록도 지운다.
--  다시 돌려도 안전(DROP 없음).
-- ════════════════════════════════════════════════════════════════════

create or replace function public.must_keep_one_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.must_admins for update;  -- 동시에 빼는 요청을 줄 세운다
  if not exists (select 1 from public.must_admins a where a.user_id <> old.user_id) then
    raise exception 'last_admin: 관리자가 최소 한 명은 있어야 합니다' using errcode = 'P0001';
  end if;
  return old;
end $$;
revoke all on function public.must_keep_one_admin() from public, anon, authenticated;
create or replace trigger must_keep_one_admin before delete on public.must_admins
  for each row execute function public.must_keep_one_admin();

do $do$
declare found boolean := false;
begin
  if to_regclass('cron.job') is not null then
    execute $q$ select exists (select 1 from cron.job where jobname = 'must-cleanup') $q$ into found;
  end if;
  if found then
    perform cron.schedule('must-cleanup', '17 4 * * *',
      $c$ delete from public.notification_jobs where fire_at < now() - interval '14 days';
          delete from cron.job_run_details where end_time < now() - interval '7 days'; $c$);
  end if;
end $do$;

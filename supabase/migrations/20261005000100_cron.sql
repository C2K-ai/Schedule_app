-- ════════════════════════════════════════════════════════════════════
--  MUST 플래너 — 예약 작업(pg_cron)
--
--  먼저 Vault 에 두 값을 넣어 두세요 (SQL Editor):
--    select vault.create_secret('https://<프로젝트ID>.supabase.co', 'must_project_url');
--    select vault.create_secret('<CRON_SECRET 과 같은 값>',          'must_cron_secret');
--  (`npm run vapid` 가 이 두 줄을 값까지 채워서 출력해 줍니다)
-- ════════════════════════════════════════════════════════════════════
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;

-- 같은 이름이 있으면 지우고 다시 등록(여러 번 실행해도 안전)
do $$
declare j text;
begin
  foreach j in array array['must-send-due', 'must-materialize-habits', 'must-cleanup'] loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
    end if;
  end loop;
end $$;

-- 1분마다: 보낼 때가 된 알림을 Edge Function 이 꺼내 Web Push 로 보낸다.
-- 일정은 보통 분 단위라 정각 알림은 그 분의 0~몇 초 안에 나간다.
-- (pg_cron 1.5+ 는 '30 seconds' 같은 초 단위도 된다 — 더 촘촘히 원하면 바꾸세요)
select cron.schedule(
  'must-send-due',
  '* * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'must_project_url')
               || '/functions/v1/send-due-notifications',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'must_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);

-- 매시 5분: 습관 → 오늘·내일 일정 생성 (사용자별 시간대 반영)
select cron.schedule('must-materialize-habits', '5 * * * *', $$ select public.materialize_habits(); $$);

-- 매일 새벽: 2주 지난 알림 기록 정리
select cron.schedule('must-cleanup', '17 4 * * *',
  $$ delete from public.notification_jobs where fire_at < now() - interval '14 days'; $$);

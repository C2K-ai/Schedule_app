-- ════════════════════════════════════════════════════════════════════
--  DREAM — 드라이브 비밀번호 잠금
--   · locked = true 인 파일은 브라우저가 비밀번호로 암호화해서 올린 것(src/lib/vault.ts).
--     서버엔 암호문만 있어 운영자도 내용을 못 본다. 이름·크기·종류는 그대로 보인다.
--  다시 돌려도 안전.
-- ════════════════════════════════════════════════════════════════════

alter table public.drive_files add column if not exists locked boolean not null default false;
grant insert (id, filename, size, mime, starred, locked) on public.drive_files to authenticated;

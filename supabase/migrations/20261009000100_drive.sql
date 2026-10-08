-- ════════════════════════════════════════════════════════════════════
--  DREAM — 드라이브(내 파일 보관함)
--   · Storage 버킷 'drive'(비공개): 파일은 '<내 user id>/<파일 id>' 에. 남의 폴더는 못 본다.
--   · drive_files: 파일 이름(한글 그대로)·크기·종류·별표 — Storage 경로는 한글을 못 써서 이름은 여기에 둔다.
--     올리는 순서: 이 표에 한 줄(용량 확인) → 그 id 로 Storage 에 올림 → ready = true. 실패하면 앱이 줄을 지운다.
--   · 한 사람당 용량(관리자 화면 → 설정, 기본 150MB). 파일 하나는 최대 50MB(Supabase 무료 요금제 한계).
--   · 승인 대기 중인 사람은 못 올린다.
--  다시 돌려도 안전.
-- ════════════════════════════════════════════════════════════════════

alter table public.must_app_settings
  add column if not exists drive_quota_mb int not null default 150 check (drive_quota_mb between 0 and 10000);

insert into storage.buckets (id, name, public, file_size_limit)
values ('drive', 'drive', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create table if not exists public.drive_files (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  filename   text not null check (char_length(filename) between 1 and 255),
  size       bigint not null check (size between 0 and 52428800),
  mime       text not null default 'application/octet-stream' check (char_length(mime) <= 255),
  starred    boolean not null default false,
  ready      boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists drive_files_user on public.drive_files (user_id, created_at desc);
alter table public.drive_files enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'drive_files' and policyname = 'own drive files') then
    create policy "own drive files" on public.drive_files for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;
-- 앱은 이름·별표·'다 올림'만 고칠 수 있다(크기·주인은 못 바꿈 — 용량 계산이 흔들리지 않게)
revoke all on public.drive_files from anon;
revoke insert, update on public.drive_files from authenticated;
grant insert (id, filename, size, mime, starred) on public.drive_files to authenticated;
grant update (filename, starred, ready, updated_at) on public.drive_files to authenticated;

-- 용량 확인 — 새 파일을 더하면 한도를 넘는지(동시에 여러 개 올려도 못 넘게 사람별 잠금)
create or replace function public.must_drive_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_quota bigint;
  v_used  bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('must_drive:' || new.user_id::text, 0));
  if not exists (select 1 from public.must_admins a where a.user_id = new.user_id)
     and not coalesce((select m.approved from public.must_members m where m.user_id = new.user_id), false) then
    raise exception 'drive_pending: 승인 후에 쓸 수 있어요' using errcode = 'P0001';
  end if;
  v_quota := coalesce((select s.drive_quota_mb from public.must_app_settings s where s.id), 150)::bigint * 1048576;
  select coalesce(sum(f.size), 0) into v_used from public.drive_files f where f.user_id = new.user_id;
  if v_used + new.size > v_quota then
    raise exception 'drive_quota: 드라이브 용량이 모자라요' using errcode = 'P0001',
      detail = json_build_object('used', v_used, 'quota', v_quota)::text;
  end if;
  return new;
end $$;
revoke all on function public.must_drive_quota() from public, anon, authenticated;
create or replace trigger drive_files_quota before insert on public.drive_files
  for each row execute function public.must_drive_quota();

-- 내 사용량 — 드라이브 화면 위쪽 막대
create or replace function public.must_drive_usage() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'used', coalesce((select sum(f.size) from public.drive_files f where f.user_id = (select auth.uid())), 0),
    'files', (select count(*) from public.drive_files f where f.user_id = (select auth.uid()) and f.ready),
    'quota', coalesce((select s.drive_quota_mb from public.must_app_settings s where s.id), 150)::bigint * 1048576,
    'max_file', 52428800
  );
$$;
revoke all on function public.must_drive_usage() from public, anon;
grant execute on function public.must_drive_usage() to authenticated;

-- 관리자 화면: 사람별 드라이브 사용량
create or replace function public.must_admin_drive()
returns table (user_id uuid, files int, bytes bigint)
language sql stable security definer set search_path = '' as $$
  select f.user_id, count(*)::int, coalesce(sum(f.size), 0)::bigint
    from public.drive_files f group by f.user_id;
$$;
revoke all on function public.must_admin_drive() from public, anon, authenticated;
grant execute on function public.must_admin_drive() to service_role;

-- Storage: 내 폴더('<내 id>/…')만 보고 지울 수 있고, 올리는 건 drive_files 에 먼저 적어 둔 경로만
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'drive own folder') then
    create policy "drive own folder" on storage.objects for all to authenticated
      using (bucket_id = 'drive' and (storage.foldername(name))[1] = (select auth.uid())::text)
      with check (
        bucket_id = 'drive'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and exists (
          select 1 from public.drive_files f
           where f.user_id = (select auth.uid()) and f.user_id::text || '/' || f.id::text = name
        )
      );
  end if;
end $$;

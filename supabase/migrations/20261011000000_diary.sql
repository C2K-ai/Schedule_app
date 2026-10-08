-- ════════════════════════════════════════════════════════════════════
--  DREAM — 일기 (기기에서 잠가서 올림)
--   · diary_entries.sealed 는 브라우저가 AES-GCM 으로 잠근 글(본문·기분). 서버엔 글이 없다 — body·mood 열을 만들지 말 것.
--   · 한 날짜에 글이 여러 개일 수 있다(두 기기가 동시에 쓰면 둘 다 남긴다). id 는 앱이 만든 무작위 UUID.
--   · 충돌: 앱이 '어느 판(ver)을 고쳤는지(base_ver)'를 같이 보낸다. 서버의 ver 와 다르면 조용히 버리고(return null),
--     앱이 그걸 알아채서 두 글을 다 남긴다. updated_at 비교(LWW)는 쓰지 않는다.
--   · diary_keys: 일기 열쇠(DEK)를 로그인 비밀번호로 감싼 것. 서버는 비밀번호를 모르니 못 푼다.
--   · 지우기는 deleted_at(+ 빈 글로 덮어쓰기). 진짜 삭제는 계정 삭제(cascade)뿐.
--  다시 돌려도 안전(DROP 없음).
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.diary_entries (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day         date not null,
  sealed      text not null,
  ver         int  not null default 1,
  base_ver    int,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now(),
  -- 'v1.<kid 22>.<iv 16>.<암호문>' — 최소 512바이트로 채운 뒤 잠그므로 짧은 글도 길이가 같다
  constraint diary_entries_sealed_shape check (
    sealed ~ '^v1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$'
    and char_length(sealed) between 740 and 100000
  )
);
create index if not exists diary_entries_user_synced on public.diary_entries (user_id, synced_at);
create index if not exists diary_entries_user_day on public.diary_entries (user_id, day);

create or replace function public.diary_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    -- 앱이 본 판(base_ver)이 지금 판(ver)이 아니면 = 다른 기기가 먼저 고침 → 버림. 날짜는 못 옮긴다(암호문에 묶여 있음)
    if new.base_ver is distinct from old.ver or new.day is distinct from old.day then
      return null;
    end if;
    new.user_id    := old.user_id;
    new.created_at := old.created_at;
    new.ver        := old.ver + 1;
    new.base_ver   := null;
  else
    -- INSERT 에선 base_ver 를 지우지 않는다: ON CONFLICT DO UPDATE 의 EXCLUDED 가 이 값을 그대로 받기 때문
    new.ver := 1;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;
revoke all on function public.diary_guard() from public, anon, authenticated;
create or replace trigger diary_entries_guard before insert or update on public.diary_entries
  for each row execute function public.diary_guard();

alter table public.diary_entries enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'diary_entries' and policyname = 'own diary entries') then
    create policy "own diary entries" on public.diary_entries for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;
revoke all on public.diary_entries from anon, authenticated;
grant select, insert, update on public.diary_entries to authenticated;

-- ───────────── 일기 열쇠 ─────────────
create table if not exists public.diary_keys (
  user_id      uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  kid          text not null check (kid ~ '^[A-Za-z0-9_-]{22}$'),
  salt         text not null check (salt ~ '^[A-Za-z0-9_-]{22}$'),
  iterations   int  not null check (iterations between 600000 and 5000000),
  wrapped      text not null check (wrapped ~ '^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{64}$'),
  -- 예전 열쇠들 — 지금 열쇠(kid)로 감싼 것 [{ "kid": "...", "w": "<iv>.<ct>" }]
  ring         jsonb not null default '[]'::jsonb
               check (jsonb_typeof(ring) = 'array' and jsonb_array_length(ring) <= 100),
  -- 열쇠가 없는 기기에서 비밀번호를 바꿈 → 열쇠가 있는 기기가 새 비밀번호로 다시 감싸 달라는 표시(비밀 아님)
  needs_rewrap boolean not null default false,
  rev          int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function public.diary_keys_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.user_id    := old.user_id;
    new.created_at := old.created_at;
    new.rev        := old.rev + 1;
  else
    new.rev := 1;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
revoke all on function public.diary_keys_guard() from public, anon, authenticated;
create or replace trigger diary_keys_guard before insert or update on public.diary_keys
  for each row execute function public.diary_keys_guard();

alter table public.diary_keys enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'diary_keys' and policyname = 'own diary key') then
    create policy "own diary key" on public.diary_keys for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;
revoke all on public.diary_keys from anon, authenticated;
grant select, insert, update on public.diary_keys to authenticated;

-- Realtime — 다른 기기의 글·열쇠 바뀜을 바로
do $$
declare t text;
begin
  foreach t in array array['diary_entries', 'diary_keys'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

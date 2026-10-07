// 스키마 테스트 — init.sql 을 실제 Postgres(PGlite, WASM)에서 돌려 트리거·RLS·함수 동작을 확인한다.
//   npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const sqlPath = process.argv[2] ?? new URL("../migrations/20261005000000_init.sql", import.meta.url);
const db = new PGlite();
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};
const q = async (sql, params) => (await db.query(sql, params)).rows;

// ── Supabase 환경 흉내 ──
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key, email text, created_at timestamptz not null default clock_timestamp(),
    last_sign_in_at timestamptz, banned_until timestamptz, email_confirmed_at timestamptz,
    raw_app_meta_data jsonb not null default '{}'::jsonb
  );
  create table auth.sessions (
    id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    refreshed_at timestamp, not_after timestamptz
  );
  create table auth.refresh_tokens (id bigserial primary key, user_id varchar, session_id uuid, revoked boolean, token varchar);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
  grant usage on schema public to authenticated, anon, service_role;
  create publication supabase_realtime;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`);

await db.exec(readFileSync(sqlPath, "utf8"));
ok(true, "init.sql 실행됨");

// Vault 흉내 + 함수 설정 마이그레이션
await db.exec(`
  create schema vault;
  create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
  insert into vault.decrypted_secrets values ('must_vapid_public', 'PUB'), ('must_cron_secret', 'CRON'), ('other_app_secret', 'NOPE');
`);
await db.exec(readFileSync(new URL("../migrations/20261006000000_config.sql", import.meta.url), "utf8"));
await db.exec(readFileSync(new URL("../migrations/20261007000000_categories_notes.sql", import.meta.url), "utf8"));
ok(true, "카테고리·노트 마이그레이션 실행됨");
await db.exec(readFileSync(new URL("../migrations/20261008000000_ai_key.sql", import.meta.url), "utf8"));
await db.exec(readFileSync(new URL("../migrations/20261008000100_study.sql", import.meta.url), "utf8"));
// 다시 돌려도 안전해야 한다(이미 적용된 서버에 또 실행해도)
await db.exec(readFileSync(new URL("../migrations/20261008000100_study.sql", import.meta.url), "utf8"));
await db.exec(readFileSync(new URL("../migrations/20261008000200_career.sql", import.meta.url), "utf8"));
await db.exec(readFileSync(new URL("../migrations/20261008000200_career.sql", import.meta.url), "utf8"));
await db.exec(readFileSync(new URL("../migrations/20261008000300_briefing.sql", import.meta.url), "utf8"));
await db.exec(readFileSync(new URL("../migrations/20261008000300_briefing.sql", import.meta.url), "utf8"));
for (const f of ["20261008000400_admin.sql", "20261008000500_admin_guards.sql"]) {
  await db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
}
ok(true, "AI 키·공부 타이머·커리어·브리핑·관리자 마이그레이션 실행됨(두 번)");
await db.exec(`set role service_role;`);
const cfg = (await q(`select public.must_function_config() c`))[0].c;
await db.exec(`reset role;`);
ok(cfg.must_vapid_public === "PUB" && cfg.must_cron_secret === "CRON" && !("other_app_secret" in cfg), "Vault 설정: 우리 값만 읽음");

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
// 실제 가입처럼 한 명씩(관리자 자동 지정은 '다른 사용자가 없을 때'만)
await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x'); insert into auth.users (id, email) values ('${B}', 'b@x');`);
const profs = await q(`select id, timezone, grace_min from public.profiles order by id`);
ok(profs.length === 2 && profs[0].timezone === "Asia/Seoul", "가입 시 프로필 자동 생성");

// 일정: 30분 뒤 시작, 60분 길이, 강제
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const T1 = "11111111-0000-4000-8000-000000000001";
await q(
  `insert into public.tasks (id, user_id, title, starts_at, ends_at, reminder_offsets, strict, created_at, updated_at)
   values ($1, $2, '독일어', $3, $4, '{10,0}', true, $5, $5)`,
  [T1, A, iso(now + 30 * 60e3), iso(now + 90 * 60e3), iso(now)],
);
let jobs = await q(`select kind, seq, fire_at from public.notification_jobs where task_id = $1 order by fire_at`, [T1]);
ok(jobs.length === 5, `알림 큐 5개 생성 (before, start, overdue×3) → ${jobs.map((j) => j.kind + j.seq).join(",")}`);
const syncedBefore = (await q(`select synced_at from public.tasks where id=$1`, [T1]))[0].synced_at;

// LWW: 오래된 updated_at 으로 덮어쓰기 → 무시
await q(`update public.tasks set title = '옛날 값', updated_at = $2 where id = $1`, [T1, iso(now - 60e3)]);
ok((await q(`select title from public.tasks where id=$1`, [T1]))[0].title === "독일어", "LWW: 오래된 쓰기는 버려짐");

// 최신 쓰기 → 반영 + 알림 재계산
await q(`update public.tasks set title='독일어 단어', starts_at=$2, ends_at=$3, updated_at=$4 where id=$1`, [
  T1, iso(now + 60 * 60e3), iso(now + 120 * 60e3), iso(now + 1000),
]);
const t1 = (await q(`select title, synced_at from public.tasks where id=$1`, [T1]))[0];
ok(t1.title === "독일어 단어", "LWW: 최신 쓰기는 반영");
ok(new Date(t1.synced_at) >= new Date(syncedBefore), "synced_at 갱신");
jobs = await q(`select kind, seq, fire_at from public.notification_jobs where task_id=$1 and sent_at is null order by fire_at`, [T1]);
const startJob = jobs.find((j) => j.kind === "start");
ok(startJob && Math.abs(new Date(startJob.fire_at).getTime() - (now + 60 * 60e3)) < 2000, "시간을 옮기면 알림 시점도 따라 이동");

// 유예 시간 변경 → 미시작 경고 재계산
await q(`update public.profiles set grace_min = 10, updated_at = now() + interval '1 second' where id = $1`, [A]);
const od1 = (await q(`select fire_at from public.notification_jobs where task_id=$1 and kind='overdue' and seq=1 and sent_at is null`, [T1]))[0];
ok(od1 && Math.abs(new Date(od1.fire_at).getTime() - (now + 70 * 60e3)) < 2000, "유예 시간 변경 → 첫 경고가 시작+10분으로");

// 시작하면 남은 알림 삭제
await q(`update public.tasks set status='in_progress', started_at=now(), updated_at=$2 where id=$1`, [T1, iso(now + 2000)]);
ok((await q(`select count(*)::int n from public.notification_jobs where task_id=$1 and sent_at is null`, [T1]))[0].n === 0, "시작하면 보낼 알림이 비워짐");

// 방금 만든 일정의 '이미 지난' 사전 알림은 만들지 않음
const T2 = "22222222-0000-4000-8000-000000000002";
await q(
  `insert into public.tasks (id, user_id, title, starts_at, ends_at, reminder_offsets, created_at, updated_at)
   values ($1, $2, '곧 시작', $3, $4, '{10,0}', $5, $5)`,
  [T2, A, iso(now + 3 * 60e3), iso(now + 33 * 60e3), iso(now)],
);
jobs = await q(`select kind from public.notification_jobs where task_id=$1`, [T2]);
ok(!jobs.some((j) => j.kind === "before") && jobs.some((j) => j.kind === "start"), "생성 전 시점의 '10분 전' 알림은 건너뜀");

// 보낼 때가 된 알림 가져가기
await q(`update public.notification_jobs set fire_at = now() - interval '1 minute' where task_id=$1 and kind='start'`, [T2]);
const claimed = await q(`select * from public.claim_due_notification_jobs(50)`);
ok(claimed.length === 1 && claimed[0].kind === "start", "claim: 때가 된 알림만 가져감");
const again = await q(`select * from public.claim_due_notification_jobs(50)`);
ok(again.length === 0, "claim: 방금 가져간 알림은 2분간 다시 안 가져감");

// 습관 → 회차 생성 + 결정적 id
const H = "c0ffee00-1234-4abc-8def-0123456789ab";
await q(
  `insert into public.habits (id, user_id, title, days, start_time, duration_min, created_at, updated_at)
   values ($1, $2, '아침 운동', '{0,1,2,3,4,5,6}', '07:00', 30, now() - interval '1 day', now())`,
  [H, A],
);
const made = (await q(`select public.materialize_habits() n`))[0].n;
ok(made === 2, `습관 회차 생성 (오늘·내일) → ${made}`);
const inst = await q(`select id, occurrence_date, starts_at, updated_at from public.tasks where habit_id=$1 order by occurrence_date`, [H]);
const habitInstanceId = (habitId, day) => {
  const hex = habitId.replace(/-/g, "").slice(0, 24) + day.replace(/-/g, "");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};
const dayStr = (d) => {
  const x = new Date(d);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
};
ok(inst.every((r) => r.id === habitInstanceId(H, dayStr(r.occurrence_date))), "서버 회차 id == 앱 habitInstanceId() (같은 행으로 합쳐짐)");
const kst = new Date(inst[0].starts_at).toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour12: false });
ok(kst.startsWith("07:00"), `회차 시작이 현지(Asia/Seoul) 07:00 → ${kst}`);
ok(new Date(inst[0].updated_at).getTime() === 0, "자동 회차 updated_at = epoch (사람이 고친 값이 이김)");
ok((await q(`select public.materialize_habits() n`))[0].n === 0, "두 번 돌려도 중복 없음");

// ── 일정 종류 ──
const TD = "dddddddd-0000-4000-8000-000000000001";
await q(
  `insert into public.tasks (id, user_id, title, starts_at, ends_at, schedule, reminder_offsets, created_at, updated_at)
   values ($1, $2, '날짜만 할 일', $3, $4, 'day', '{10,0}', $5, $5)`,
  [TD, A, iso(now + 2 * 3600e3), iso(now + 26 * 3600e3), iso(now)],
);
ok((await q(`select count(*)::int n from public.notification_jobs where task_id=$1`, [TD]))[0].n === 0, "날짜만 할 일은 알림 큐가 안 생김");
const TT = "dddddddd-0000-4000-8000-000000000002";
await q(
  `insert into public.tasks (id, user_id, title, starts_at, ends_at, created_at, updated_at)
   values ($1, $2, '시각 지정', $3, $4, $5, $5)`,
  [TT, A, iso(now + 40 * 60e3), iso(now + 70 * 60e3), iso(now)],
);
const before = (await q(`select count(*)::int n from public.notification_jobs where task_id=$1 and sent_at is null`, [TT]))[0].n;
await q(`update public.tasks set schedule='day', updated_at=$2 where id=$1`, [TT, iso(now + 5000)]);
const after = (await q(`select count(*)::int n from public.notification_jobs where task_id=$1 and sent_at is null`, [TT]))[0].n;
ok(before > 0 && after === 0, `시각→날짜만으로 바꾸면 알림 큐 비움 (${before}→${after})`);
ok((await q(`select schedule, starred from public.tasks where id=$1`, [TD]))[0].starred === false, "starred 기본값 false");

// ── 카테고리·노트 ──
const CA = "cccccccc-0000-4000-8000-000000000001";
await q(`insert into public.categories (id, user_id, name, color, sort) values ($1, $2, '작업', 'blue', 1)`, [CA, A]);
await q(`update public.tasks set category_id=$2, updated_at=$3 where id=$1`, [TD, CA, iso(now + 6000)]);
await q(`insert into public.day_notes (user_id, day, body, mood) values ($1, '2026-10-07', '오늘은 단어 50개', 4)`, [A]);
let dup = false;
try {
  await q(`insert into public.day_notes (user_id, day, body) values ($1, '2026-10-07', '두 번째')`, [A]);
} catch {
  dup = true;
}
ok(dup, "하루 노트는 사용자·날짜당 하나");

// ── 공부 타이머 ──
const SU = "dddddddd-0000-4000-8000-000000000001";
await q(`insert into public.subjects (id, user_id, name, color) values ($1, $2, '독일어', 'amber')`, [SU, A]);
await q(`insert into public.study_sessions (user_id, subject_id, started_at, ended_at) values ($1, $2, now() - interval '50 minutes', now())`, [A, SU]);
await q(`insert into public.study_sessions (user_id, subject_id, started_at) values ($1, $2, now())`, [A, SU]);
let badRange = false;
try {
  await q(`insert into public.study_sessions (user_id, started_at, ended_at) values ($1, now(), now() - interval '1 minute')`, [A]);
} catch {
  badRange = true;
}
ok(badRange, "공부 기록: 끝이 시작보다 앞설 수 없음");
await q(`update public.subjects set deleted_at = now(), updated_at = now() + interval '1 second' where id = $1`, [SU]);
ok((await q(`select count(*)::int n from public.study_sessions where subject_id = $1`, [SU]))[0].n === 2, "과목을 지워도(soft) 기록은 남음");

// ── 아침 브리핑 ──
{
  // 지금 서울 시각 기준으로 '방금 지난' 시각과 '아직 안 온' 시각을 만든다
  const seoul = (await q(`select to_char(now() at time zone 'Asia/Seoul', 'HH24:MI') t, (now() at time zone 'Asia/Seoul')::time lt`))[0];
  const [hh, mm] = seoul.t.split(":").map(Number);
  const mins = hh * 60 + mm;
  const fmt = (m) => `${String(Math.floor(((m + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
  const past = fmt(mins - 5);
  const future = fmt(mins + 30);
  await q(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, briefing_time) values
    ($1, 'https://push/a', 'k', 'a', $2), ($1, 'https://push/b', 'k', 'a', $3), ($1, 'https://push/c', 'k', 'a', null)`, [A, past, future]);
  let badTime = false;
  try {
    await q(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, briefing_time) values ($1, 'https://push/x', 'k', 'a', '25:00')`, [A]);
  } catch {
    badTime = true;
  }
  ok(badTime, "브리핑 시각 형식 검사");
  await db.exec(`set role service_role;`);
  const first = await q(`select endpoint, local_day, day_end - day_start as span from public.claim_due_briefings()`);
  const second = await q(`select endpoint from public.claim_due_briefings()`);
  await db.exec(`reset role;`);
  // 자정 근처(00:00~00:05, 21:00 이후)에는 'past' 가 조건 밖이라 0개가 정상
  const inWindow = mins >= 5 && mins - 5 < 21 * 60;
  ok(
    inWindow ? first.length === 1 && first[0].endpoint === "https://push/a" : first.length === 0,
    `브리핑: 시각이 지난 기기만 꺼냄 (${first.map((r) => r.endpoint).join(",") || "없음"})`,
  );
  ok(second.length === 0, "브리핑: 같은 날 두 번 꺼내지 않음");
  let claimDenied = false;
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${A}', false);`);
  try {
    await q(`select * from public.claim_due_briefings()`);
  } catch {
    claimDenied = true;
  }
  await db.exec(`reset role;`);
  ok(claimDenied, "브리핑: 일반 사용자는 꺼낼 수 없음");
}

// ── 커리어 ──
await q(
  `insert into public.career_entries (user_id, title, kind, start_day, end_day, raw, skills, task_ids)
   values ($1, '플래너 앱 개발', 'project', '2026-10-01', '2026-10-31', '혼자 만듦', '{Next.js,Supabase}', $2)`,
  [A, `{${T1}}`],
);
let badKind = false;
try {
  await q(`insert into public.career_entries (user_id, title, kind, start_day) values ($1, 'x', 'hobby', '2026-10-01')`, [A]);
} catch {
  badKind = true;
}
ok(badKind, "커리어: 정해진 종류만");
let badPeriod = false;
try {
  await q(`insert into public.career_entries (user_id, title, start_day, end_day) values ($1, 'x', '2026-10-02', '2026-10-01')`, [A]);
} catch {
  badPeriod = true;
}
ok(badPeriod, "커리어: 끝 날짜가 시작보다 앞설 수 없음");

// ── RLS ──
await db.exec(`insert into public.task_logs (id, user_id, kind, reason, title) values
  ('99999999-0000-4000-8000-000000000001', '${A}', 'postponed', '회의가 길어짐', '독일어');`);
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${B}', false);`);
ok((await q(`select count(*)::int n from public.tasks`))[0].n === 0, "RLS: B 는 A 의 일정을 못 봄");
ok((await q(`select count(*)::int n from public.categories`))[0].n === 0, "RLS: B 는 A 의 카테고리를 못 봄");
ok((await q(`select count(*)::int n from public.day_notes`))[0].n === 0, "RLS: B 는 A 의 하루 노트를 못 봄");
ok((await q(`select count(*)::int n from public.study_sessions`))[0].n === 0, "RLS: B 는 A 의 공부 기록을 못 봄");
ok((await q(`select count(*)::int n from public.subjects`))[0].n === 0, "RLS: B 는 A 의 과목을 못 봄");
ok((await q(`select count(*)::int n from public.career_entries`))[0].n === 0, "RLS: B 는 A 의 커리어 기록을 못 봄");
await db.exec(`select set_config('request.jwt.claim.sub', '${A}', false);`);
ok((await q(`select count(*)::int n from public.tasks`))[0].n === 6, "RLS: A 는 자기 일정 6개를 봄");
// 트리거 함수 EXECUTE 를 회수해도 로그인 사용자의 쓰기에서 트리거는 그대로 돈다
const T9 = "99999999-0000-4000-8000-0000000000aa";
await q(`insert into public.tasks (id, user_id, title, starts_at, ends_at) values ($1, $2, '트리거 확인', now() + interval '1 hour', now() + interval '2 hours')`, [T9, A]);
const jobsT9 = (await q(`select count(*)::int n from public.notification_jobs where task_id = $1`, [T9]))[0].n;
ok(jobsT9 >= 2, `권한 회수 뒤에도 트리거 동작 (알림 ${jobsT9}개 생성)`);
let rpcDenied = false;
try { await q(`select public.sync_task_jobs()`); } catch { rpcDenied = true; }
ok(rpcDenied, "트리거 함수는 직접 호출 불가");
let threw = false;
try {
  await q(`insert into public.tasks (id, user_id, title, starts_at, ends_at) values (gen_random_uuid(), '${B}', '남의 것', now(), now() + interval '1 hour')`);
} catch {
  threw = true;
}
ok(threw, "RLS: 남의 user_id 로는 못 씀");
const denied = async (sql) => {
  try {
    return (await db.query(sql)).affectedRows === 0;
  } catch {
    return true;
  }
};
ok(await denied(`update public.task_logs set reason = '조작' where kind = 'postponed'`), "사유 기록은 수정 불가");
ok(await denied(`delete from public.task_logs`), "사유 기록은 삭제 불가");
ok(await denied(`insert into public.notification_jobs (user_id, task_id, kind, seq, fire_at) values ('${A}', '${T1}', 'start', 0, now())`), "알림 큐는 앱이 직접 못 씀");
// 앱이 쓰는 upsert(중복 무시) 경로
await q(`insert into public.task_logs (id, user_id, kind, reason) values ('99999999-0000-4000-8000-000000000001', '${A}', 'postponed', 'x') on conflict (id) do nothing`);
ok((await q(`select reason from public.task_logs`))[0].reason === "회의가 길어짐", "사유 기록 재전송(중복)은 무시");
threw = false;
try {
  await q(`select * from public.claim_due_notification_jobs(1)`);
} catch {
  threw = true;
}
ok(threw, "일반 사용자는 claim 함수 호출 불가");
threw = false;
try {
  await q(`select public.must_function_config()`);
} catch {
  threw = true;
}
ok(threw, "일반 사용자는 Vault 설정 못 읽음");
await db.exec(`reset role;`);

// ── 관리자 ──
{
  const admins = await q(`select user_id from public.must_admins`);
  ok(admins.length === 1 && admins[0].user_id === A, "첫 가입자(A)만 자동으로 관리자");
  await db.exec(readFileSync(new URL("../migrations/20261008000400_admin.sql", import.meta.url), "utf8"));
  ok((await q(`select count(*)::int n from public.must_admins`))[0].n === 1, "마이그레이션을 다시 돌려도 관리자 그대로");

  const as = async (uid, sql) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
    try {
      return await q(sql);
    } finally {
      await db.exec(`reset role;`);
    }
  };
  const fails = async (uid, sql) => {
    try {
      const r = await as(uid, sql);
      return r.length === 0;
    } catch {
      return true;
    }
  };
  ok((await as(A, `select public.must_is_admin() v`))[0].v === true, "must_is_admin: 관리자는 true");
  ok((await as(B, `select public.must_is_admin() v`))[0].v === false, "must_is_admin: 일반 사용자는 false");
  ok(await fails(B, `select * from public.must_admins`), "일반 사용자는 관리자 목록 못 읽음");
  ok(await fails(A, `select * from public.must_admins`), "관리자도 앱에서 직접은 못 읽음(Edge Function 경유)");
  ok(await fails(B, `select * from public.must_app_settings`), "앱 설정 표는 직접 못 읽음");
  ok(await fails(B, `insert into public.must_admins (user_id) values ('${B}') returning user_id`), "스스로 관리자 등록 불가");
  ok(await fails(A, `select * from public.must_admin_users()`), "관리자 통계 함수는 앱에서 직접 못 부름");
  ok(await fails(A, `select public.must_admin_overview()`), "관리자 개요 함수도 직접 못 부름");
  ok(await fails(B, `select public.must_admin_signout('${A}')`), "남을 로그아웃시키는 함수 직접 호출 불가");
  ok(await fails(B, `select public.must_ai_claim('${B}', 'parse-schedule', 'm')`), "AI 한도 예약 함수 직접 호출 불가");
  ok(await fails(B, `insert into public.ai_usage (user_id, fn, model) values ('${B}', 'x', 'm') returning id`), "AI 사용 기록은 앱이 못 씀");

  // AI 사용 기록·한도
  await db.exec(`insert into public.ai_usage (user_id, fn, model, input_tokens, output_tokens, created_at) values
    ('${B}', 'parse-schedule', 'claude-haiku-4-5', 1000, 200, now()),
    ('${B}', 'parse-schedule', 'claude-haiku-4-5', 1200, 300, now()),
    ('${B}', 'career-polish', 'claude-haiku-4-5', 3000, 600, now()),
    ('${B}', 'parse-schedule', 'claude-haiku-4-5', 900, 100, now() - interval '2 days'),
    ('${A}', 'parse-schedule', 'claude-haiku-4-5', 800, 150, now())`);
  ok((await as(B, `select count(*)::int n from public.ai_usage`))[0].n === 4, "AI 사용 기록: 내 것만 보임");

  // 통계
  await db.exec(`reset role;`);
  await db.exec(`insert into auth.sessions (user_id, updated_at) values ('${B}', now()), ('${B}', now() - interval '1 hour');
                 insert into auth.refresh_tokens (user_id, revoked, token) values ('${B}', false, 't1'), ('${A}', false, 't2');
                 update auth.users set last_sign_in_at = now() - interval '30 days' where id = '${B}';`);
  await db.exec(`set role service_role;`);
  const users = await q(`select * from public.must_admin_users()`);
  const ub = users.find((u) => u.id === B);
  const ua = users.find((u) => u.id === A);
  ok(users.length === 2 && ua.is_admin && !ub.is_admin, "사용자 목록: 2명, 관리자 표시");
  ok(ub.ai_today === 3 && ub.ai_month_calls >= 3 && Number(ub.ai_month_input) >= 5200, `사용자 목록: AI 사용량 → 오늘 ${ub.ai_today}, 이번 달 ${ub.ai_month_calls}`);
  ok(ub.sessions === 2 && ub.last_active_at && Date.now() - new Date(ub.last_active_at).getTime() < 3600e3, "사용자 목록: 세션 수·최근 활동(세션 기준)");
  ok(typeof ua.tasks === "number" && ua.tasks >= 1 && ub.provider === "email", "사용자 목록: 일정 수·로그인 방식");
  const ov = (await q(`select public.must_admin_overview() v`))[0].v;
  ok(ov.users === 2 && ov.ai_today === 4 && ov.settings.signups_open === false && ov.settings.ai_daily_limit === 30, `개요: ${JSON.stringify({ users: ov.users, ai: ov.ai_today, settings: ov.settings })}`);
  ok(Array.isArray(ov.ai_month) && ov.ai_month[0]?.model === "claude-haiku-4-5" && Array.isArray(ov.cron), "개요: 모델별 이번 달 사용량, 크론(없으면 빈 목록)");
  const n = (await q(`select public.must_admin_signout('${B}') n`))[0].n;
  await db.exec(`reset role;`);
  ok(
    n === 2 && (await q(`select count(*)::int n from auth.sessions where user_id = '${B}' and (not_after is null or not_after > now())`))[0].n === 0,
    "모든 기기 로그아웃: 세션 만료",
  );
  const rt = await q(`select user_id, revoked from auth.refresh_tokens order by id`);
  ok(rt[0].revoked === true && rt[1].revoked === false, "모든 기기 로그아웃: 그 사람 갱신 토큰만 무효");
  await db.exec(`set role service_role;`);
  ok((await q(`select sessions from public.must_admin_users() where id = '${B}'`))[0].sessions === 0, "로그아웃 뒤 로그인 기기 0");
  await db.exec(`reset role;`);

  // AI 한도 예약(원자적) — 한국 자정 기준, 프로필 시간대와 무관
  await db.exec(`update public.must_app_settings set ai_daily_limit = 5`);
  await db.exec(`set role service_role;`);
  const claim = async (u) => (await q(`select public.must_ai_claim('${u}', 'parse-schedule', 'claude-haiku-4-5') v`))[0].v;
  const c1 = await claim(B);
  const c2 = await claim(B);
  const c3 = await claim(B);
  ok(c1.ok && c1.used === 4 && c2.used === 5 && c3.ok === false && c3.limit === 5, `AI 예약: 오늘 3회 + 2회 → 6번째는 막힘 (${c1.used},${c2.used},${c3.ok})`);
  await db.exec(`reset role;`);
  // 시간대를 바꿔 '오늘'을 당기는 꼼수가 안 통함 + 이상한 시간대는 서울로
  await as(B, `update public.profiles set timezone = '<X>-9:14:07', updated_at = now() + interval '1 minute' where id = '${B}' returning id`);
  await db.exec(`set role service_role;`);
  ok((await claim(B)).ok === false, "AI 예약: 프로필 시간대를 바꿔도 한도 그대로");
  await db.exec(`reset role;`);
  await as(B, `update public.profiles set timezone = 'Not/AZone', updated_at = now() + interval '2 minutes' where id = '${B}' returning id`);
  ok((await q(`select timezone from public.profiles where id = '${B}'`))[0].timezone === "Asia/Seoul", "잘못된 시간대는 서울로 되돌림(크론 보호)");
  await db.exec(`set role service_role;`);
  const ca = await claim(A);
  ok(ca.ok && ca.admin === true, "AI 예약: 관리자는 한도 없음");
  const placeholder = (await q(`select model, input_tokens from public.ai_usage where id = ${ca.id}`))[0];
  ok(placeholder.model === "claude-haiku-4-5" && placeholder.input_tokens === 0, "AI 예약: 자리 표시 행이 생김(나중에 토큰 채움)");
  await db.exec(`reset role;`);
  // 관리자 해제: 마지막 관리자는 못 뺀다(트리거)
  threw = false;
  try {
    await q(`delete from public.must_admins where user_id = '${A}'`);
  } catch (e) {
    threw = String(e.message).includes("last_admin");
  }
  ok(threw, "마지막 관리자는 뺄 수 없음");
  await q(`insert into public.must_admins (user_id) values ('${B}')`);
  await q(`delete from public.must_admins where user_id = '${B}'`);
  ok((await q(`select count(*)::int n from public.must_admins`))[0].n === 1, "다른 관리자는 뺄 수 있고 한 명 남음");
  await db.exec(`update public.must_app_settings set ai_daily_limit = 30`);

  // 1인 전용 잠금 ↔ 가입 받기
  await db.exec(readFileSync(new URL("../migrations/20261006000100_single_owner.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../migrations/20261008000400_admin.sql", import.meta.url), "utf8"));
  const C = "cccccccc-0000-4000-8000-000000000003";
  threw = false;
  try {
    await q(`insert into auth.users (id, email) values ('${C}', 'c@x')`);
  } catch {
    threw = true;
  }
  ok(threw, "가입 받기 꺼짐: 새 가입 막힘");
  await db.exec(`set role anon;`);
  ok((await q(`select public.must_signups_open() v`))[0].v === false, "로그인 화면: 가입 닫힘을 알 수 있음(익명)");
  await db.exec(`reset role;`);
  await db.exec(`update public.must_app_settings set signups_open = true`);
  await q(`insert into auth.users (id, email) values ('${C}', 'c@x')`);
  ok((await q(`select count(*)::int n from public.must_admins where user_id = '${C}'`))[0].n === 0, "가입 받기 켜짐: 가입됨, 관리자는 아님");
  // 관리자가 아무도 없게 된 서버에서도, 다른 사용자가 있으면 새 가입자는 관리자가 되지 않는다
  await db.exec(`alter table public.must_admins disable trigger must_keep_one_admin; delete from public.must_admins;
                 alter table public.must_admins enable trigger must_keep_one_admin;`);
  const D = "dddddddd-0000-4000-8000-000000000004";
  await q(`insert into auth.users (id, email) values ('${D}', 'd@x')`);
  ok((await q(`select count(*)::int n from public.must_admins`))[0].n === 0, "관리자 없는 서버: 새 가입자가 자동 관리자 안 됨");
  await q(`insert into public.must_admins (user_id) values ('${A}')`);
  await db.exec(`set role anon;`);
  ok((await q(`select public.must_signups_open() v`))[0].v === true, "로그인 화면: 가입 열림");
  await db.exec(`reset role;`);
  await db.exec(`update public.must_app_settings set signups_open = false`);
  threw = false;
  try {
    await db.exec(`update public.must_app_settings set ai_daily_limit = -1`);
  } catch {
    threw = true;
  }
  ok(threw, "AI 한도는 0~1000 만");
}

console.log(failures ? `\n${failures}개 실패` : "\n전부 통과");
process.exit(failures ? 1 : 0);

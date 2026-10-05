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
  create table auth.users (id uuid primary key, email text);
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
await db.exec(`set role service_role;`);
const cfg = (await q(`select public.must_function_config() c`))[0].c;
await db.exec(`reset role;`);
ok(cfg.must_vapid_public === "PUB" && cfg.must_cron_secret === "CRON" && !("other_app_secret" in cfg), "Vault 설정: 우리 값만 읽음");

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@x'), ('${B}', 'b@x');`);
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

// ── RLS ──
await db.exec(`insert into public.task_logs (id, user_id, kind, reason, title) values
  ('99999999-0000-4000-8000-000000000001', '${A}', 'postponed', '회의가 길어짐', '독일어');`);
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${B}', false);`);
ok((await q(`select count(*)::int n from public.tasks`))[0].n === 0, "RLS: B 는 A 의 일정을 못 봄");
await db.exec(`select set_config('request.jwt.claim.sub', '${A}', false);`);
ok((await q(`select count(*)::int n from public.tasks`))[0].n === 4, "RLS: A 는 자기 일정 4개를 봄");
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

console.log(failures ? `\n${failures}개 실패` : "\n전부 통과");
process.exit(failures ? 1 : 0);

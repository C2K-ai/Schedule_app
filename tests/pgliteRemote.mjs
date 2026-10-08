// 테스트용 '서버' — PGlite(진짜 Postgres) 위에 init.sql + 일기 마이그레이션을 올리고,
// DiaryRemote 를 PostgREST 처럼 흉내 낸다(로그인 사용자 권한 + RLS + 트리거 그대로).
// 고장 내기: fail(method, "network"|"error"|{status, code, message}) · afterCommitThrow(method)(커밋은 됐는데 답이 끊김) · setOffline(true)
//   {status, …} 는 supabase-js 가 돌려주는 오류 모양 그대로 diaryRemote 의 분류(toError)를 거친다 — 503·401 등
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { NetworkError, toError } from "../src/lib/diaryRemote.ts";

const migration = (f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8");

const KEY_COLS = "kid, salt, iterations, wrapped, ring, needs_rewrap, rev";
// PostgREST 처럼 JSON 으로 — 시각은 '2026-10-08T04:39:00.123456+00:00', 날짜는 '2026-10-08'
const ENTRY_JSON = "to_jsonb(e) - 'user_id' - 'base_ver'";
const ENTRY_COLS = new Set(["id", "day", "sealed", "created_at", "updated_at", "deleted_at", "base_ver"]);
const quote = (c) => `"${String(c).replace(/"/g, '""')}"`;

export async function bootDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, created_at timestamptz not null default clock_timestamp(),
      last_sign_in_at timestamptz, banned_until timestamptz, email_confirmed_at timestamptz,
      raw_app_meta_data jsonb not null default '{}'::jsonb, raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
    grant usage on schema public to authenticated, anon, service_role;
    create publication supabase_realtime;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  `);
  await db.exec(migration("20261005000000_init.sql"));
  await db.exec(migration("20261011000000_diary.sql"));

  const passwords = new Map();
  /** 관리자(슈퍼유저) 권한 SQL — 서버를 직접 건드리는 공격자 흉내 */
  const sql = async (text, params) => (await db.query(text, params)).rows;

  async function addUser(uid, pw) {
    await sql(`insert into auth.users (id, email) values ($1, $2)`, [uid, `${uid}@x`]);
    passwords.set(uid, pw);
  }

  function remote(uid) {
    const faults = [];
    const lost = new Set();
    const calls = [];
    let offline = false;

    // 로그인한 그 사용자로(트랜잭션 안에서만 역할·JWT 를 바꾼다)
    const as = (fn) =>
      db.transaction(async (tx) => {
        await tx.query("set local role authenticated");
        await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
        return fn(tx);
      });

    const wrap = (method, impl) => async (...args) => {
      calls.push({ method, args });
      if (offline) throw new NetworkError("TypeError: Failed to fetch (offline)");
      const i = faults.findIndex((f) => f.method === method && (!f.when || f.when(...args)));
      if (i >= 0) {
        const f = faults[i];
        if (--f.times <= 0) faults.splice(i, 1);
        if (f.kind && typeof f.kind === "object") throw toError({ message: f.kind.message ?? `injected ${method} ${f.kind.status}`, code: f.kind.code ?? "" }, f.kind.status);
        throw f.kind === "network" ? new NetworkError("TypeError: Failed to fetch (injected)") : new Error(`injected ${method} error`);
      }
      const res = await impl(...args);
      if (lost.has(method)) {
        lost.delete(method);
        throw new NetworkError("TypeError: Failed to fetch (response lost)");
      }
      return res;
    };

    const api = {
      verifyPassword: wrap("verifyPassword", async (pw) => (passwords.get(uid) === pw ? "ok" : "wrong")),
      getKeyRow: wrap("getKeyRow", async () =>
        as(async (tx) => (await tx.query(`select ${KEY_COLS} from public.diary_keys`)).rows[0] ?? null),
      ),
      insertKeyRow: wrap("insertKeyRow", async (r) =>
        as(async (tx) => {
          const res = await tx.query(
            `insert into public.diary_keys (kid, salt, iterations, wrapped, ring) values ($1, $2, $3, $4, $5::jsonb)
             on conflict (user_id) do nothing returning rev`,
            [r.kid, r.salt, r.iterations, r.wrapped, JSON.stringify(r.ring ?? [])],
          );
          return res.rows.length === 1;
        }),
      ),
      casKeyRow: wrap("casKeyRow", async (rev, patch) =>
        as(async (tx) => {
          const cols = Object.keys(patch);
          const vals = cols.map((c) => (c === "ring" ? JSON.stringify(patch[c]) : patch[c]));
          const set = cols.map((c, i) => `${quote(c)} = $${i + 1}${c === "ring" ? "::jsonb" : ""}`).join(", ");
          const res = await tx.query(
            `update public.diary_keys set ${set} where user_id = $${cols.length + 1} and rev = $${cols.length + 2} returning ${KEY_COLS}`,
            [...vals, uid, rev],
          );
          return res.rows[0] ?? null;
        }),
      ),
      setNeedsRewrap: wrap("setNeedsRewrap", async () =>
        as(async (tx) => {
          await tx.query(`update public.diary_keys set needs_rewrap = true where user_id = $1`, [uid]);
        }),
      ),
      // PostgREST upsert: 보낸 열만 INSERT … ON CONFLICT (id) DO UPDATE SET 열 = EXCLUDED.열
      pushEntry: wrap("pushEntry", async (r) =>
        as(async (tx) => {
          const cols = Object.keys(r);
          const bad = cols.filter((c) => !ENTRY_COLS.has(c));
          if (bad.length) throw new Error(`column ${bad.join(",")} does not exist`);
          const res = await tx.query(
            `insert into public.diary_entries (${cols.map(quote).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})
             on conflict (id) do update set ${cols.filter((c) => c !== "id").map((c) => `${quote(c)} = excluded.${quote(c)}`).join(", ")}
             returning ver, to_jsonb(synced_at) #>> '{}' as synced_at`,
            cols.map((c) => r[c]),
          );
          return res.rows[0] ?? null;
        }),
      ),
      getEntry: wrap("getEntry", async (id) =>
        as(async (tx) => (await tx.query(`select ${ENTRY_JSON} as j from public.diary_entries e where id = $1`, [id])).rows[0]?.j ?? null),
      ),
      // PostgREST 와 같이: order=synced_at,id · after 만 있으면 gt, afterId 도 있으면 (synced_at, id) 키셋
      pullEntries: wrap("pullEntries", async (after, limit, afterId = null) =>
        as(async (tx) =>
          (
            await tx.query(
              `select ${ENTRY_JSON} as j from public.diary_entries e
               where ($1::timestamptz is null or synced_at > $1::timestamptz
                      or ($3::uuid is not null and synced_at = $1::timestamptz and id > $3::uuid))
               order by synced_at, id limit $2`,
              [after, limit, afterId],
            )
          ).rows.map((x) => x.j),
        ),
      ),
    };

    return Object.assign(api, {
      calls,
      count: (method, when) => calls.filter((c) => c.method === method && (!when || when(...c.args))).length,
      /** 다음 호출(들)을 실패시킨다. kind: "network" | "error", when: 인자 조건 */
      fail(method, kind = "network", { times = 1, when } = {}) {
        faults.push({ method, kind, times, when });
      },
      failNext(method, kind = "network") {
        faults.push({ method, kind, times: 1 });
      },
      clearFaults() {
        faults.length = 0;
      },
      /** 서버엔 반영되는데 답이 안 옴 */
      afterCommitThrow(method) {
        lost.add(method);
      },
      setOffline(v) {
        offline = v;
      },
    });
  }

  return {
    db,
    sql,
    addUser,
    setPassword: (uid, pw) => passwords.set(uid, pw),
    remote,
    keyRow: async (uid) => (await sql(`select ${KEY_COLS} from public.diary_keys where user_id = $1`, [uid]))[0] ?? null,
    entries: async (uid) =>
      (await sql(`select ${ENTRY_JSON} as j from public.diary_entries e where user_id = $1 order by created_at`, [uid])).map((x) => x.j),
    close: () => db.close(),
  };
}

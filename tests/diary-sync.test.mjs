// 일기 동기화 시나리오 — 기기 여러 대를 PGlite '서버'에 붙여서 돌린다. npm run test:unit
import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { bootDb } from "./pgliteRemote.mjs";
import { DiaryEngine, diaryList, diaryLockedCount, diaryOn } from "../src/lib/diary.ts";
import { idbDiaryStorage, memoryDiaryStorage } from "../src/lib/diaryStorage.ts";
import { diaryAfterLogin, unlockWithPassword } from "../src/lib/diaryKeys.ts";
import { isNetworkError, toError } from "../src/lib/diaryRemote.ts";

const PW = "dream-diary-2026";
const PW2 = "새-비밀번호-2027";
const D = "2026-10-08";

let h;
before(async () => {
  h = await bootDb();
});
after(async () => {
  await h.close();
});

const engines = [];
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose();
});

async function newUser(pw = PW) {
  const uid = randomUUID();
  await h.addUser(uid, pw);
  return uid;
}

/** 기기 하나(= 엔진 + 그 기기 저장소 + 서버 연결) */
function device(uid, o = {}) {
  const storage = o.storage ?? memoryDiaryStorage();
  const remote = o.remote ?? h.remote(uid);
  const eng = new DiaryEngine({ uid, mode: "cloud", remote, storage, onChange: () => {}, uploadDelayMs: 0 });
  eng.start();
  engines.push(eng);
  return { uid, eng, remote, storage, snap: () => eng.snapshot() };
}

async function until(fn, what = "조건", ms = 5000) {
  const t = Date.now();
  while (!(await fn())) {
    if (Date.now() - t > ms) throw new Error(`시간 초과: ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** 열린 기기 — 이미 열쇠가 있으면 비밀번호로 열고, 없으면 만든다 */
async function ready(uid, o = {}) {
  const dev = device(uid, o);
  await dev.eng.settle();
  if (dev.snap().state.kind !== "ready") assert.equal(await dev.eng.unlock(o.pw ?? PW), "ok");
  await dev.eng.settle();
  assert.equal(dev.snap().state.kind, "ready");
  return dev;
}

const bodies = (dev, day = D) => diaryOn(dev.snap(), day).map((e) => e.body).sort();
const entry = (dev, id) => dev.snap().entries[id];
const ringOf = async (dev) => dev.storage.getKeyring(dev.uid);

async function write(dev, input) {
  const r = dev.eng.save({ day: D, ...input });
  assert.ok(r.ok, JSON.stringify(r));
  await dev.eng.settle();
  return r.id;
}

test("1. 로그인하면 열쇠가 생기고, 다른 기기도 같은 열쇠로 열려 글이 건너간다", async () => {
  const uid = await newUser();
  const A = device(uid);
  await A.eng.settle();
  assert.deepEqual(A.snap().state, { kind: "locked", why: "first_time" });
  // AuthForm 경로 — 방금 로그인한 비밀번호로
  assert.equal(await diaryAfterLogin(null, uid, PW, { storage: A.storage, remote: A.remote }), "ok");
  await until(() => A.snap().state.kind === "ready", "A 열림");
  await A.eng.settle();
  assert.deepEqual(A.snap().state, { kind: "ready", weak: false, repair: null });
  const id = await write(A, { body: "오늘은 바다를 봤다", mood: 4 });
  await A.eng.flush();
  assert.equal(A.snap().pending, 0);

  const B = device(uid);
  await B.eng.settle();
  assert.deepEqual(B.snap().state, { kind: "locked", why: "need_password" });
  assert.equal(entry(B, id).locked, true); // 받아는 왔지만 아직 못 엶
  assert.equal(await B.eng.unlock(PW), "ok");
  await B.eng.settle();
  assert.equal((await ringOf(B)).current, (await ringOf(A)).current);
  assert.equal((await h.keyRow(uid)).kid, (await ringOf(A)).current);
  assert.deepEqual(bodies(B), ["오늘은 바다를 봤다"]);
  assert.equal(entry(B, id).mood, 4);
  assert.equal(entry(B, id).locked, false);
  // 서버엔 잠긴 글만
  const [row] = await h.entries(uid);
  assert.match(row.sealed, /^v1\./);
  assert.ok(!("body" in row) && !("mood" in row));
});

test("2. 틀린 비밀번호는 열쇠를 건드리지 않는다(오타 방지)", async () => {
  const uid = await newUser();
  const A = device(uid);
  await A.eng.settle();
  assert.equal(await A.eng.unlock("dream-diary-2025"), "wrong_password");
  assert.equal(await h.keyRow(uid), null, "열쇠 행이 생기지 않음");
  assert.deepEqual(A.snap().state, { kind: "locked", why: "first_time" });
  assert.equal(await A.eng.unlock(PW), "ok");
  const rev = (await h.keyRow(uid)).rev;

  const B = device(uid);
  await B.eng.settle();
  assert.equal(await B.eng.unlock("오타비밀번호"), "wrong_password");
  assert.equal((await h.keyRow(uid)).rev, rev);
  // 확인됐다고 넘겨도 틀린 비밀번호는 열쇠를 못 바꾼다 — 열쇠 없는 기기면 old_password, 쓰기 없음
  assert.equal(await unlockWithPassword({ uid, storage: B.storage, remote: B.remote }, "오타비밀번호", { verified: true }), "old_password");
  assert.equal((await h.keyRow(uid)).rev, rev);
  assert.equal(B.remote.count("casKeyRow") + B.remote.count("insertKeyRow"), 0);
});

test("3. 두 기기가 동시에 처음 열어도 열쇠는 하나", async () => {
  const uid = await newUser();
  const sA = memoryDiaryStorage();
  const sB = memoryDiaryStorage();
  const [ra, rb] = await Promise.all([
    unlockWithPassword({ uid, storage: sA, remote: h.remote(uid) }, PW, { verified: true }),
    unlockWithPassword({ uid, storage: sB, remote: h.remote(uid) }, PW, { verified: true }),
  ]);
  assert.deepEqual([ra, rb], ["ok", "ok"]);
  const rows = await h.sql(`select kid from public.diary_keys where user_id = $1`, [uid]);
  assert.equal(rows.length, 1);
  assert.equal((await sA.getKeyring(uid)).current, rows[0].kid);
  assert.equal((await sB.getKeyring(uid)).current, rows[0].kid);
});

test("4. 두 기기가 오프라인으로 같은 날 쓰면 둘 다 남는다", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  const B = await ready(uid);
  A.remote.setOffline(true);
  B.remote.setOffline(true);
  await write(A, { body: "A의 하루" });
  await write(B, { body: "B의 하루" });
  assert.equal(A.snap().pending, 1);
  A.remote.setOffline(false);
  B.remote.setOffline(false);
  await A.eng.flush();
  await B.eng.flush();
  assert.equal((await h.entries(uid)).filter((e) => e.day === D).length, 2);
  await A.eng.pull();
  await B.eng.pull();
  assert.deepEqual(bodies(A), ["A의 하루", "B의 하루"]);
  assert.deepEqual(bodies(B), ["A의 하루", "B의 하루"]);
  assert.equal(A.snap().pending + B.snap().pending, 0);
});

test("5. 같은 글을 동시에 고치면 — 먼저 올린 쪽이 그 글, 늦은 쪽은 사본", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  const B = await ready(uid);
  const X = await write(A, { body: "처음 글" });
  await A.eng.flush();
  await B.eng.pull();
  assert.deepEqual(bodies(B), ["처음 글"]);
  A.remote.setOffline(true);
  B.remote.setOffline(true);
  await write(A, { id: X, body: "A가 고침", base: { body: "처음 글" } });
  await write(B, { id: X, body: "B가 고침", base: { body: "처음 글" } });
  A.remote.setOffline(false);
  B.remote.setOffline(false);
  await A.eng.flush();
  assert.equal((await h.entries(uid)).find((e) => e.id === X).ver, 2);
  await B.eng.flush(); // 버려짐 → 사본으로
  assert.equal(entry(B, X).body, "A가 고침");
  assert.deepEqual(bodies(B), ["A가 고침", "B가 고침"]);
  assert.equal(B.snap().pending, 0);
  await A.eng.pull();
  await B.eng.pull();
  assert.deepEqual(bodies(A), ["A가 고침", "B가 고침"]);
  assert.deepEqual(bodies(B), ["A가 고침", "B가 고침"]);
  const server = await h.entries(uid);
  assert.equal(server.length, 2);
  assert.ok(server.some((e) => e.id === X && e.ver === 2));
});

test("6. 올라갔는데 답이 끊김 — 다음 올리기에서 내 것임을 알아보고 사본을 만들지 않는다", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  A.remote.setOffline(true);
  const X = await write(A, { body: "답을 못 받은 글" });
  A.remote.setOffline(false);
  A.remote.afterCommitThrow("pushEntry");
  await A.eng.flush();
  assert.equal(entry(A, X).dirty, true);
  assert.equal((await h.entries(uid)).length, 1, "서버엔 이미 들어감");
  await A.eng.flush();
  assert.equal(entry(A, X).dirty, false);
  assert.equal(A.snap().pending, 0);
  assert.equal(Object.keys(A.snap().entries).length, 1, "사본 없음");
  assert.equal((await h.entries(uid)).length, 1);
  assert.equal(A.remote.count("getEntry"), 1);
});

test("7. 편집 중에 다른 곳에서 바뀌면 초안은 사본으로 — 같은 편집기의 다음 저장도 그 사본으로", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  const B = await ready(uid);
  const X = await write(A, { body: "처음" });
  await A.eng.flush();
  await B.eng.pull();
  await write(A, { id: X, body: "A가 바꿈", base: { body: "처음" } });
  await A.eng.flush();
  await B.eng.pull();
  assert.equal(entry(B, X).body, "A가 바꿈");
  // B 의 편집기는 '처음'을 보고 쓰기 시작했다
  const r1 = B.eng.save({ id: X, day: D, body: "B의 초안", base: { body: "처음" } });
  assert.ok(r1.ok && r1.id !== X);
  assert.equal(entry(B, X).body, "A가 바꿈");
  assert.equal(entry(B, r1.id).body, "B의 초안");
  const r2 = B.eng.save({ id: X, day: D, body: "B의 초안 더", base: { body: "처음" } });
  assert.ok(r2.ok);
  assert.equal(r2.id, r1.id, "같은 사본을 다시 씀");
  // 마지막 저장을 base 로 넘기는 편집기도 같은 사본
  const r3 = B.eng.save({ id: X, day: D, body: "B의 초안 끝", base: { body: "B의 초안 더" } });
  assert.equal(r3.id, r1.id);
  assert.deepEqual(bodies(B), ["A가 바꿈", "B의 초안 끝"]);
  // 바뀐 게 없으면 그 글에 그대로
  const r4 = B.eng.save({ id: X, day: D, body: "A가 바꿈!", base: { body: "A가 바꿈" } });
  assert.equal(r4.id, X);
  // 자기 저장은 충돌이 아니다(편집기가 첫 타자 때 base 를 잡아 두고 계속 저장해도)
  const r5 = B.eng.save({ id: X, day: D, body: "A가 바꿈!!", base: { body: "A가 바꿈" } });
  assert.equal(r5.id, X);
  await B.eng.settle();
  await B.eng.flush();
  await A.eng.pull();
  assert.deepEqual(bodies(A), ["A가 바꿈!!", "B의 초안 끝"]);
});

test("8. 지우기 vs 고치기 — 어느 순서든 고친 글이 남는다", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  const B = await ready(uid);
  const X = await write(A, { body: "공유 글", mood: 2 });
  const Y = await write(A, { body: "공유 글2" });
  await A.eng.flush();
  await B.eng.pull();

  // A 가 먼저 지우고 올림, B 는 오프라인으로 고침
  B.remote.setOffline(true);
  await write(B, { id: X, body: "B가 고침", base: { body: "공유 글" } });
  assert.equal(A.eng.remove(X), true);
  await A.eng.settle();
  await A.eng.flush();
  assert.ok((await h.entries(uid)).find((e) => e.id === X).deleted_at);
  B.remote.setOffline(false);
  await B.eng.flush(); // 저쪽이 지움 → 내 글을 그 판 위로 옮겨 다시 올림
  assert.equal(entry(B, X).body, "B가 고침");
  assert.equal(entry(B, X).deleted_at, null);
  assert.equal(B.snap().pending, 0);
  const sx = (await h.entries(uid)).find((e) => e.id === X);
  assert.equal(sx.deleted_at, null);
  assert.equal(sx.ver, 3);
  await A.eng.pull();
  assert.equal(entry(A, X).body, "B가 고침");
  assert.equal(entry(A, X).deleted_at, null);

  // B 가 먼저 고쳐 올림, A 는 오프라인으로 지움
  A.remote.setOffline(true);
  assert.equal(A.eng.remove(Y), true);
  await A.eng.settle();
  await write(B, { id: Y, body: "B가 먼저 고침", base: { body: "공유 글2" } });
  await B.eng.flush();
  A.remote.setOffline(false);
  await A.eng.flush(); // 내 지우기는 접힌다
  assert.equal(entry(A, Y).body, "B가 먼저 고침");
  assert.equal(entry(A, Y).deleted_at, null);
  assert.equal(A.snap().pending, 0);
  assert.equal((await h.entries(uid)).find((e) => e.id === Y).deleted_at, null);
  // 되살아난 글은 다시 고칠 수 있다
  assert.equal(A.eng.save({ id: Y, day: D, body: "A도 고침", base: { body: "B가 먼저 고침" } }).id, Y);

  // 지운 글(빈 글로 덮어씀)은 다른 기기에서 빈 글로 열린다
  const Z = await write(A, { body: "지울 글", mood: 5 });
  assert.equal(A.eng.remove(Z), true);
  // 지운 뒤 늦게 온 저장(편집기 닫힘)은 되살리지 않는다
  assert.deepEqual(A.eng.save({ id: Z, day: D, body: "지울 글!" }), { ok: true, id: Z });
  await A.eng.settle();
  await A.eng.flush();
  const C = await ready(uid);
  const z = entry(C, Z);
  assert.ok(z.deleted_at);
  assert.equal(z.locked, false);
  assert.equal(z.body, "");
  assert.equal(z.mood, null);
  assert.ok(!diaryOn(C.snap(), D).some((e) => e.id === Z));

  // 다른 기기에서 지워진 글에 늦게 저장하면 — 지운 글은 되살리지 않고 새 글로
  const W = await write(A, { body: "곧 지워질 글" });
  await A.eng.flush();
  await B.eng.pull();
  assert.equal(A.eng.remove(W), true);
  await A.eng.settle();
  await A.eng.flush();
  await B.eng.pull();
  assert.ok(entry(B, W).deleted_at);
  const rw = B.eng.save({ id: W, day: D, body: "B의 늦은 초안", base: { body: "곧 지워질 글" } });
  assert.ok(rw.ok && rw.id !== W);
  assert.ok(entry(B, W).deleted_at);
  assert.equal(entry(B, W).body, "");
  assert.equal(entry(B, rw.id).body, "B의 늦은 초안");
  assert.equal(B.eng.save({ id: W, day: D, body: "B의 늦은 초안2", base: { body: "곧 지워질 글" } }).id, rw.id);
});

test("9. 한 글만 계속 실패해도 다른 글은 올라가고, 그 글은 남는다(5번 뒤엔 자동 재시도 멈춤)", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  A.remote.setOffline(true);
  const bad = await write(A, { body: "문제의 글" });
  const ok1 = await write(A, { body: "멀쩡한 글 1" });
  const ok2 = await write(A, { body: "멀쩡한 글 2" });
  A.remote.setOffline(false);
  A.remote.fail("pushEntry", "error", { times: Infinity, when: (r) => r.id === bad });
  await A.eng.flush();
  assert.equal(entry(A, ok1).dirty, false);
  assert.equal(entry(A, ok2).dirty, false);
  assert.equal(entry(A, bad).dirty, true);
  assert.match(entry(A, bad).err, /injected/);
  assert.match(A.snap().error, /^일기 올리기 실패/);
  const tries = async () => (await A.storage.getRow(uid, bad)).tries;
  for (let i = 0; i < 10 && (await tries()) < 5; i++) await A.eng.flush();
  assert.equal(await tries(), 5);
  const n = A.remote.count("pushEntry", (r) => r.id === bad);
  await A.eng.flush();
  await A.eng.flush();
  assert.equal(A.remote.count("pushEntry", (r) => r.id === bad), n, "5번 뒤엔 안 보냄");
  const kept = await A.storage.getRow(uid, bad);
  assert.equal(kept.dirty, true, "버리지 않음");
  assert.equal(entry(A, bad).body, "문제의 글");
  assert.equal(A.snap().pending, 1);
  // 고치면 다시 시도한다
  A.remote.clearFaults();
  await write(A, { id: bad, body: "문제의 글(고침)", base: { body: "문제의 글" } });
  await A.eng.flush();
  assert.equal(entry(A, bad).dirty, false);
  assert.equal(entry(A, bad).err, null);
  assert.equal(A.snap().pending, 0);
});

test("10. 열쇠 있는 기기에서 비밀번호 바꾸기 — 새 열쇠, 옛 열쇠는 ring 에. 다른 기기는 새 비밀번호로 다 읽음", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  const B = await ready(uid);
  await write(A, { body: "옛 글" });
  await A.eng.flush();
  const K1 = (await h.keyRow(uid)).kid;
  const res = await A.eng.changePassword(PW2, async () => {
    h.setPassword(uid, PW2);
    return { error: null };
  });
  assert.equal(res.error, null);
  await A.eng.settle();
  const row = await h.keyRow(uid);
  assert.notEqual(row.kid, K1);
  assert.deepEqual(
    row.ring.map((e) => e.kid),
    [K1],
  );
  assert.equal(row.iterations, 600000);
  assert.equal((await ringOf(A)).current, row.kid);
  assert.equal((await ringOf(A)).pending, null);
  assert.equal(A.snap().state.kind, "ready");
  await write(A, { body: "새 글" });
  await A.eng.flush();

  await B.eng.refresh();
  assert.deepEqual(B.snap().state, { kind: "locked", why: "key_changed" });
  // B 는 지금 열쇠(K1)를 그대로 쥐고 있다 — 쓰던 글은 잠김 카드로 바뀌어도 계속 저장된다(초안을 잃지 않게)
  const mid = B.eng.save({ day: D, body: "열쇠가 바뀐 사이에 쓴 글" });
  assert.ok(mid.ok, JSON.stringify(mid));
  await B.eng.settle();
  await B.eng.flush();
  assert.equal(B.snap().pending, 0);
  assert.equal(await B.eng.unlock(PW), "wrong_password");
  assert.equal(await B.eng.unlock(PW2), "ok");
  await B.eng.settle();
  assert.equal(B.snap().state.kind, "ready");
  assert.deepEqual(bodies(B), ["새 글", "열쇠가 바뀐 사이에 쓴 글", "옛 글"]);
  assert.equal(diaryLockedCount(B.snap()), 0);
  // K1 으로 잠근 그 글도 A(K2 + ring 의 K1)가 읽는다
  await A.eng.pull();
  assert.deepEqual(bodies(A), ["새 글", "열쇠가 바뀐 사이에 쓴 글", "옛 글"]);
});

test("11. 비밀번호를 바꿨는데 열쇠 올리기가 끊김 — 보류해 두었다가 다시 연결되면 올린다", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  await write(A, { body: "끊겨도 괜찮아" });
  await A.eng.flush();
  const K1 = (await h.keyRow(uid)).kid;
  A.remote.fail("casKeyRow", "network", { times: Infinity });
  const res = await A.eng.changePassword(PW2, async () => {
    h.setPassword(uid, PW2);
    return { error: null };
  });
  assert.equal(res.error, null);
  await A.eng.settle();
  const pending = (await ringOf(A)).pending;
  assert.ok(pending && pending.confirmed && pending.fromKid === K1);
  assert.equal((await h.keyRow(uid)).kid, K1, "아직 안 올라감");
  // 보류 중에도 쓰기는 된다(지금 열쇠 그대로)
  await write(A, { body: "보류 중에 쓴 글" });
  A.remote.clearFaults();
  A.eng.onOnline();
  await A.eng.settle();
  assert.equal((await h.keyRow(uid)).kid, pending.kid);
  assert.equal((await ringOf(A)).pending, null);
  assert.equal((await ringOf(A)).current, pending.kid);
  await A.eng.flush();
  const C = await ready(uid, { pw: PW2 });
  assert.deepEqual(bodies(C), ["끊겨도 괜찮아", "보류 중에 쓴 글"]);
});

test("11b. 비밀번호 바꾸기가 실패하면 보류한 열쇠를 버린다", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  const K1 = (await h.keyRow(uid)).kid;
  const res = await A.eng.changePassword(PW2, async () => ({ error: new Error("weak_password") }));
  assert.ok(res.error);
  await A.eng.settle();
  assert.equal((await ringOf(A)).pending, null);
  assert.equal((await h.keyRow(uid)).kid, K1);
  assert.equal(A.snap().state.kind, "ready");
});

test("12. 열쇠 없는 기기에서 비밀번호를 바꾸면 — 다시 감싸 달라 표시, 열쇠 있는 기기가 새 비밀번호로 고침", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  await write(A, { body: "A가 쓴 글" });
  await A.eng.flush();
  const C = device(uid);
  await C.eng.settle();
  assert.deepEqual(C.snap().state, { kind: "locked", why: "need_password" });
  const res = await C.eng.changePassword(PW2, async () => {
    h.setPassword(uid, PW2);
    return { error: null };
  });
  assert.equal(res.error, null);
  await C.eng.settle();
  assert.equal((await h.keyRow(uid)).needs_rewrap, true);
  assert.deepEqual(C.snap().state, { kind: "locked", why: "old_password" });

  await A.eng.refresh();
  assert.deepEqual(A.snap().state, { kind: "ready", weak: false, repair: "rewrap" });
  const before = await h.keyRow(uid);
  assert.equal(await A.eng.unlock(PW2), "ok");
  const after = await h.keyRow(uid);
  assert.equal(after.needs_rewrap, false);
  assert.notEqual(after.kid, before.kid, "새 비밀번호로 새 열쇠");
  assert.notEqual(after.salt, before.salt);
  assert.deepEqual(A.snap().state, { kind: "ready", weak: false, repair: null });

  // C 는 기억해 둔 새 비밀번호로 저절로 열린다(열리는 기기가 다시 감싼 뒤)
  await C.eng.refresh();
  await C.eng.settle();
  assert.equal(C.snap().state.kind, "ready");
  assert.deepEqual(bodies(C), ["A가 쓴 글"]);
  assert.equal(await C.eng.unlock(PW2), "ok");
});

test("13. 새로 시작 — 새 열쇠(빈 ring). 옛 열쇠를 가진 기기가 열면 ring 에 보태져서 모두 열림", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  const old = await write(A, { body: "A의 옛 글" });
  await A.eng.flush();
  const K1 = (await h.keyRow(uid)).kid;
  // 열쇠 없는 곳에서(관리자 재설정 링크 등) 비밀번호가 바뀜 — 열쇠는 아직 옛 비밀번호로 감싸여 있음
  h.setPassword(uid, PW2);
  const C = device(uid);
  await C.eng.settle();
  assert.equal(await C.eng.unlock(PW2), "old_password");
  assert.deepEqual(C.snap().state, { kind: "locked", why: "old_password" });
  assert.equal(await C.eng.unlock(PW2, { oldPassword: "틀린-옛-비밀번호" }), "old_wrong");
  assert.equal(await C.eng.reset("틀림"), "wrong_password");
  assert.equal(await C.eng.reset(PW2), "ok");
  await C.eng.settle();
  const row = await h.keyRow(uid);
  const K2 = row.kid;
  assert.notEqual(K2, K1);
  assert.deepEqual(row.ring, []);
  assert.equal(C.snap().state.kind, "ready");
  assert.equal(entry(C, old).locked, true, "옛 글은 잠긴 채(지우지 않음)");
  assert.equal(diaryLockedCount(C.snap()), 1);
  // 열려 있어도 잠긴 글은 읽기 전용
  assert.deepEqual(C.eng.save({ id: old, day: D, body: "덮어쓰기" }), { ok: false, error: "locked" });
  assert.equal(C.eng.remove(old), false);
  await write(C, { body: "C의 새 글" });
  await C.eng.flush();

  await A.eng.refresh();
  assert.deepEqual(A.snap().state, { kind: "locked", why: "key_changed" });
  assert.equal(await A.eng.unlock(PW2), "ok");
  const merged = await h.keyRow(uid);
  assert.equal(merged.kid, K2, "A 는 K2 를 덮어쓰지 않는다");
  assert.deepEqual(
    merged.ring.map((e) => e.kid),
    [K1],
  );
  assert.deepEqual(bodies(A), ["A의 옛 글", "C의 새 글"]);

  await C.eng.refresh();
  await C.eng.settle();
  assert.equal(entry(C, old).locked, false);
  assert.equal(entry(C, old).body, "A의 옛 글");
  assert.equal(diaryLockedCount(C.snap()), 0);
});

test("14. 반복 횟수 낮춰치기 — 열쇠 가진 기기는 상수 값·새 소금으로 다시 감싸고, 열쇠 없는 기기는 아무것도 안 씀", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  await write(A, { body: "낮춰치기 전에 쓴 글" });
  await A.eng.flush();
  const before = await h.keyRow(uid);
  await h.sql(`alter table public.diary_keys drop constraint diary_keys_iterations_check`);
  try {
    await h.sql(`update public.diary_keys set iterations = 1000 where user_id = $1`, [uid]);
    const tampered = await h.keyRow(uid);
    assert.equal(tampered.iterations, 1000);
    const K = device(uid);
    await K.eng.settle();
    assert.equal(await K.eng.unlock(PW), "old_password");
    assert.equal((await h.keyRow(uid)).rev, tampered.rev, "열쇠 없는 기기는 쓰지 않음");
    assert.equal(K.remote.count("casKeyRow") + K.remote.count("insertKeyRow"), 0);

    assert.equal(await A.eng.unlock(PW), "ok");
    const fixed = await h.keyRow(uid);
    assert.equal(fixed.iterations, 600000);
    assert.notEqual(fixed.salt, before.salt);
    assert.notEqual(fixed.kid, before.kid);
  } finally {
    await h.sql(
      `alter table public.diary_keys add constraint diary_keys_iterations_check check (iterations between 600000 and 5000000)`,
    );
  }
  const K2 = await ready(uid);
  assert.deepEqual(bodies(K2), ["낮춰치기 전에 쓴 글"]);
});

test("15. 서버에서 sealed 를 바꿔치기하거나 날짜를 옮기면 그 글은 잠기고, 다시 올라가지도 않는다", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  const P = await write(A, { body: "글 P" });
  const Q = await write(A, { body: "글 Q" });
  await A.eng.flush();
  await h.sql(
    `update public.diary_entries set sealed = (select sealed from public.diary_entries where id = $2), base_ver = ver where id = $1`,
    [P, Q],
  );
  await h.sql(`set session_replication_role = replica`);
  try {
    await h.sql(`update public.diary_entries set day = '2026-10-09', ver = ver + 1, synced_at = clock_timestamp() where id = $1`, [Q]);
  } finally {
    await h.sql(`set session_replication_role = default`);
  }
  const pushes = A.remote.count("pushEntry");
  await A.eng.pull();
  assert.equal(entry(A, P).locked, true);
  assert.equal(entry(A, Q).locked, true);
  assert.equal(entry(A, Q).day, "2026-10-09");
  assert.equal(A.snap().pending, 0);
  assert.deepEqual(A.eng.save({ id: P, day: D, body: "덮어쓰기" }), { ok: false, error: "locked" });
  assert.equal(A.eng.remove(Q), false);
  await A.eng.flush();
  assert.equal(A.remote.count("pushEntry"), pushes);
});

test("16. 열쇠 없는 기기 — 받아는 오되 잠긴 채, 쓰기·지우기 안 됨, 올릴 것도 없음", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  const e1 = await write(A, { body: "하나" });
  await write(A, { body: "둘", mood: 3 });
  await A.eng.flush();
  const K = device(uid);
  await K.eng.settle();
  await K.eng.pull();
  assert.deepEqual(K.snap().state, { kind: "locked", why: "need_password" });
  const list = diaryList(K.snap());
  assert.equal(list.length, 2);
  assert.ok(list.every((e) => e.locked && e.body === "" && e.mood === null));
  assert.deepEqual(K.eng.save({ day: D, body: "새 글" }), { ok: false, error: "locked" });
  assert.deepEqual(K.eng.save({ id: e1, day: D, body: "고침" }), { ok: false, error: "locked" });
  assert.equal(K.eng.remove(e1), false);
  await K.eng.settle();
  assert.equal(K.snap().pending, 0);
  assert.ok((await K.storage.rows(uid)).every((r) => !r.dirty), "잠긴 글도 저장은 됨(나중에 열 수 있게), dirty 아님");
  assert.equal((await K.storage.rows(uid)).length, 2);
  await K.eng.flush();
  assert.equal(K.remote.count("pushEntry"), 0);
});

test("17. 같은 기기의 두 탭 — 한 탭에서 로그인하면 다른 탭도 열리고, 쓴 글이 건너간다", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  await write(A, { body: "다른 기기에서 쓴 글" });
  await A.eng.flush();
  const shared = memoryDiaryStorage();
  const T1 = device(uid, { storage: shared });
  const T2 = device(uid, { storage: shared });
  await T1.eng.settle();
  await T2.eng.settle();
  assert.equal(T2.snap().state.kind, "locked");
  assert.equal(await diaryAfterLogin(null, uid, PW, { storage: shared, remote: T1.remote }), "ok");
  await until(() => T2.snap().state.kind === "ready", "탭2 열림");
  await until(() => bodies(T2).includes("다른 기기에서 쓴 글"), "탭2 복호화");
  await until(() => T1.snap().state.kind === "ready", "탭1 열림");
  const id = T1.eng.save({ day: D, body: "탭1에서 씀" }).id;
  await T1.eng.settle();
  await until(() => entry(T2, id)?.body === "탭1에서 씀", "탭2 에 건너감");
  // 탭2 에서 고치면 탭1 에도
  T2.eng.save({ id, day: D, body: "탭2에서 고침", base: { body: "탭1에서 씀" } });
  await T2.eng.settle();
  await until(() => entry(T1, id)?.body === "탭2에서 고침", "탭1 에 건너감");
  await T1.eng.flush();
  await T2.eng.flush();
  await T1.eng.settle();
  await T2.eng.settle();
  assert.equal((await h.entries(uid)).filter((e) => e.id === id).length, 1);
  assert.equal(T1.snap().pending + T2.snap().pending, 0);
  await A.eng.pull();
  assert.deepEqual(bodies(A), ["다른 기기에서 쓴 글", "탭2에서 고침"]);
});

test("17b. 서버 없는 빌드(기기 모드)에서 두 탭이 동시에 켜져도 열쇠는 하나 — 새로고침해도 열림", async () => {
  const shared = memoryDiaryStorage();
  const mk = () => {
    const eng = new DiaryEngine({ uid: "local", mode: "device", remote: null, storage: shared, onChange: () => {} });
    eng.start();
    engines.push(eng);
    return eng;
  };
  const t1 = mk();
  const t2 = mk();
  await t1.settle();
  await t2.settle();
  const ring = await shared.getKeyring("local");
  assert.equal(Object.keys(ring.keys).length, 1, "열쇠 하나");
  assert.deepEqual(t1.snapshot().state, { kind: "ready", weak: false, repair: null });
  const id = t1.save({ day: D, body: "기기에만 있는 일기" }).id;
  await t1.settle();
  await until(() => t2.snapshot().entries[id]?.body === "기기에만 있는 일기", "탭2 에 건너감");
  assert.equal(t1.snapshot().pending, 0);
  assert.equal(await t1.wipe(), true, "기기 모드는 올릴 게 없으니 바로 지울 수 있음");
  const t3 = mk();
  await t3.settle();
  assert.deepEqual(t3.snapshot().entries, {});
});

test("18. 실시간 알림이 순서가 뒤바뀌어 와도 최신 판을 지킨다. sealed 빠진 알림은 직접 받아 온다", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  const B = await ready(uid);
  const X = await write(A, { body: "v1" });
  await A.eng.flush();
  await B.eng.pull();
  const snapAt = async () => (await h.entries(uid)).find((e) => e.id === X);
  await write(A, { id: X, body: "v2", base: { body: "v1" } });
  await A.eng.flush();
  const e2 = await snapAt();
  await write(A, { id: X, body: "v3", base: { body: "v2" } });
  await A.eng.flush();
  const e3 = await snapAt();
  assert.deepEqual([e2.ver, e3.ver], [2, 3]);

  const hs = [];
  const ch = {
    on(type, filter, cb) {
      hs.push({ type, filter, cb });
      return ch;
    },
  };
  B.eng.attachRealtime(ch);
  assert.deepEqual(
    hs.map((x) => [x.filter.table, x.filter.filter]),
    [
      ["diary_entries", `user_id=eq.${uid}`],
      ["diary_keys", `user_id=eq.${uid}`],
    ],
  );
  const fire = async (row) => {
    hs[0].cb({ new: row });
    await B.eng.settle();
  };
  await fire(e3);
  assert.equal(entry(B, X).body, "v3");
  await fire(e2);
  assert.equal(entry(B, X).body, "v3", "늦게 온 옛 판은 무시");
  await write(A, { id: X, body: "v4", base: { body: "v3" } });
  await A.eng.flush();
  const e4 = await snapAt();
  const gets = B.remote.count("getEntry");
  const { sealed: _drop, ...noSealed } = e4;
  void _drop;
  await fire(noSealed);
  assert.equal(B.remote.count("getEntry"), gets + 1);
  assert.equal(entry(B, X).body, "v4");
  await fire({ ...e4, ver: 4, sealed: e4.sealed.slice(0, 200) }); // 잘린 sealed
  assert.equal(entry(B, X).body, "v4");
  // 열쇠 알림 → 서버 열쇠 점검
  const checks = B.remote.count("getKeyRow");
  hs[1].cb({ new: {} });
  await B.eng.settle();
  assert.ok(B.remote.count("getKeyRow") > checks);
});

test("19. 이 기기에서 지우기 — 못 올린 글이 있으면 거절, 다 올린 뒤엔 저장소가 빈다", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  A.remote.setOffline(true);
  await write(A, { body: "아직 안 올라간 글" });
  assert.equal(await A.eng.wipe(), false);
  assert.equal((await A.storage.rows(uid)).length, 1);
  assert.ok(await A.storage.getKeyring(uid));
  A.remote.setOffline(false);
  assert.equal(await A.eng.wipe(), true);
  assert.deepEqual(await A.storage.rows(uid), []);
  assert.equal(await A.storage.getKeyring(uid), null);
  assert.equal(await A.storage.getMeta(uid, "cursor"), null);
  assert.deepEqual(A.snap().entries, {});
  // 서버엔 남아 있다 — 다시 로그인하면 그대로
  assert.equal((await h.entries(uid)).length, 1);
  const again = await ready(uid);
  assert.deepEqual(bodies(again), ["아직 안 올라간 글"]);
});

test("20. 올리는 값은 정확히 7개 열, 평문은 한 글자도 안 감", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  const secret = "아무도 몰라야 하는 비밀 일기 내용 #4821";
  const X = await write(A, { body: secret, mood: 5 });
  await A.eng.flush();
  A.eng.remove(X);
  await A.eng.settle();
  await A.eng.flush();
  const pushes = A.remote.calls.filter((c) => c.method === "pushEntry");
  assert.equal(pushes.length, 2);
  for (const c of pushes) {
    assert.deepEqual(Object.keys(c.args[0]).sort(), ["base_ver", "created_at", "day", "deleted_at", "id", "sealed", "updated_at"]);
    assert.ok(!JSON.stringify(c.args).includes("비밀"));
    assert.ok(!JSON.stringify(c.args).includes("4821"));
  }
  // 열쇠 쪽으로도 평문·비밀번호가 가지 않는다(비밀번호 확인 말고)
  for (const c of A.remote.calls.filter((c) => c.method !== "verifyPassword")) {
    assert.ok(!JSON.stringify(c.args).includes(PW));
    assert.ok(!JSON.stringify(c.args).includes("비밀 일기"));
  }
  const dump = JSON.stringify(await h.sql(`select * from public.diary_entries where user_id = $1`, [uid]));
  assert.ok(!dump.includes("비밀"));
});

test("21. 일기는 TABLES·DB·백업 파일에 없다", async () => {
  const store = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
  const tables = store.match(/export const TABLES[^=]*=\s*\[([^\]]*)\]/);
  assert.ok(tables);
  assert.ok(!/diary/i.test(tables[1]));
  const types = readFileSync(new URL("../src/lib/types.ts", import.meta.url), "utf8");
  const dbType = types.match(/export interface DB \{([^}]*)\}/);
  assert.ok(dbType);
  assert.ok(!/diary/i.test(dbType[1]));
  for (const fn of ["emptyDb", "importDb", "exportJson"]) {
    const body = store.slice(store.indexOf(fn), store.indexOf(fn) + 1500);
    assert.ok(!/diary/i.test(body.split("\n  }\n")[0]), fn);
  }

  const { PlannerStore } = await import("../src/lib/store.ts");
  const st = new PlannerStore("local", null, null, "device", memoryDiaryStorage());
  st.diary.start();
  await st.diary.settle();
  assert.equal(st.getSnapshot().diary.state.kind, "ready");
  const secret = "백업에 들어가면 안 되는 일기";
  assert.ok(st.diary.save({ day: D, body: secret, mood: 3 }).ok);
  await st.diary.settle();
  await until(() => Object.values(st.getSnapshot().diary.entries).some((e) => e.body === secret), "스냅샷 연결");
  assert.equal(st.getSnapshot().diary.pending, 0, "기기 모드 — 저장되면 끝");
  const json = st.exportJson();
  assert.ok(!json.includes(secret));
  assert.ok(!/diary/i.test(json));
  st.dispose();
});

// ───────────── 검토에서 나온 문제들 — 고친 뒤 다시 생기지 않게 ─────────────

/** 실시간 채널 흉내 — attachRealtime 이 붙인 diary_entries 처리기를 직접 부른다 */
function realtime(dev) {
  const hs = [];
  const ch = {
    on(type, filter, cb) {
      hs.push({ filter, cb });
      return ch;
    },
  };
  dev.eng.attachRealtime(ch);
  return async (row) => {
    hs[0].cb({ new: row });
    await dev.eng.settle();
  };
}

/** 서버 synced_at 을 과거로(트리거 끄고) — 오래전 일처럼 */
async function age(ids, minutes) {
  await h.sql(`set session_replication_role = replica`);
  try {
    await h.sql(`update public.diary_entries set synced_at = synced_at - make_interval(mins => $2) where id = any($1)`, [ids, minutes]);
  } finally {
    await h.sql(`set session_replication_role = default`);
  }
}

/** 지난 글 n 개를 서버에 바로 넣는다(같은 sealed — 열리진 않아도 개수는 센다) */
async function history(uid, n, sealed, syncedAt) {
  await h.sql(
    `insert into public.diary_entries (id, user_id, day, sealed) select gen_random_uuid(), $1, date '2024-01-01' + g, $2 from generate_series(1, $3::int) g`,
    [uid, sealed, n],
  );
  await h.sql(`set session_replication_role = replica`);
  try {
    if (syncedAt) await h.sql(`update public.diary_entries set synced_at = $2 where user_id = $1`, [uid, syncedAt]);
    else
      await h.sql(
        `update public.diary_entries set synced_at = (day::timestamp + interval '21 hours') at time zone 'UTC' where user_id = $1 and day < '2026-01-01'`,
        [uid],
      );
  } finally {
    await h.sql(`set session_replication_role = default`);
  }
}

test("22. 받기가 한 번 실패한 사이 실시간 알림(내 글의 메아리)이 와도 — 그 구간의 다른 기기 글을 놓치지 않는다", async () => {
  const uid = await newUser();
  const L = await ready(uid); // 노트북
  const P = await ready(uid); // 폰
  const fire = realtime(P);
  const old = await write(L, { body: "오래전에 맞춘 글" });
  await L.eng.flush();
  await P.eng.pull();
  await age([old], 26 * 60);
  await P.storage.putMeta(uid, "cursor", (await h.entries(uid))[0].synced_at);
  P.eng["cursor"] = null;
  // 폰이 하루 꺼져 있는 동안 노트북이 씀
  P.remote.setOffline(true);
  const l1 = await write(L, { body: "노트북: 아침" });
  const l2 = await write(L, { body: "노트북: 저녁" });
  await L.eng.flush();
  await age([l1, l2], 12 * 60);
  const p1 = await write(P, { body: "폰: 꺼진 채로 씀" });
  // 다시 연결 — 따라잡는 받기가 한 번 실패(503 등), 그사이 폰이 올린 글의 실시간 메아리가 옴
  P.remote.setOffline(false);
  P.remote.fail("pullEntries", { status: 503 });
  P.eng.onOnline();
  await P.eng.settle();
  await fire((await h.entries(uid)).find((e) => e.id === p1));
  await P.eng.pull();
  await P.eng.settle();
  assert.deepEqual(bodies(P), ["노트북: 아침", "노트북: 저녁", "오래전에 맞춘 글", "폰: 꺼진 채로 씀"]);
});

test("23. 첫 받기 2쪽째가 실패하고 실시간 알림이 와도 — 나머지 지난 글을 다 받는다", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  const X = await write(A, { body: "씨앗" });
  await A.eng.flush();
  const sealed = (await h.entries(uid))[0].sealed;
  await history(uid, 700, sealed, null);
  const total = (await h.entries(uid)).length;
  const remote = h.remote(uid);
  remote.fail("pullEntries", "network", { when: (after) => after !== null });
  const B = device(uid, { remote });
  const fire = realtime(B);
  await B.eng.settle();
  assert.equal(Object.keys(B.snap().entries).length, 500, "첫 쪽만");
  const Y = await write(A, { body: "오늘 새 글" });
  await A.eng.flush();
  await fire((await h.entries(uid)).find((e) => e.id === Y));
  await B.eng.pull();
  await B.eng.settle();
  assert.equal(Object.keys(B.snap().entries).length, total + 1);
  assert.equal(entry(B, X).body, "");
  assert.equal(entry(B, X).locked, true); // 열쇠가 없는 기기 — 받아는 옴
});

test("24. 같은 synced_at 이 쪽 경계에 걸려도(701개 동시각) 하나도 빠뜨리지 않는다", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  await write(A, { body: "씨앗" });
  await A.eng.flush();
  const sealed = (await h.entries(uid))[0].sealed;
  await history(uid, 700, sealed, "2025-01-01T00:00:00Z");
  const B = device(uid);
  await B.eng.settle();
  assert.equal(Object.keys(B.snap().entries).length, 701);
  const pages = B.remote.calls.filter((c) => c.method === "pullEntries");
  assert.equal(pages[1].args[2] && typeof pages[1].args[2], "string", "둘째 쪽은 (synced_at, id) 로 이어 받음");
});

test("25. sealed 빠진 실시간 알림 + getEntry 끊김 — 커서가 밀리지 않아 다음 받기에서 새 판을 받는다", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  const B = await ready(uid);
  const fire = realtime(B);
  const X = await write(A, { body: "v1" });
  await A.eng.flush();
  await B.eng.pull();
  const cursor0 = await B.storage.getMeta(uid, "cursor");
  await write(A, { id: X, body: "v2", base: { body: "v1" } });
  await A.eng.flush();
  const x2 = (await h.entries(uid)).find((e) => e.id === X);
  B.remote.fail("getEntry", "network");
  const { sealed: _s, ...noSealed } = x2;
  void _s;
  await fire(noSealed);
  assert.equal(entry(B, X).body, "v1");
  // 몇 분 뒤 다른 글의 알림이 정상으로 옴 — 그래도 받기 커서는 그대로
  const Y = await write(A, { body: "나중 글" });
  await A.eng.flush();
  await h.sql(`set session_replication_role = replica`);
  try {
    await h.sql(`update public.diary_entries set synced_at = synced_at + interval '3 minutes' where id = $1`, [Y]);
  } finally {
    await h.sql(`set session_replication_role = default`);
  }
  await fire((await h.entries(uid)).find((e) => e.id === Y));
  assert.equal(entry(B, Y).body, "나중 글");
  assert.equal(await B.storage.getMeta(uid, "cursor"), cursor0, "실시간 알림은 커서를 밀지 않는다");
  await B.eng.pull();
  assert.equal(entry(B, X).body, "v2");
});

/** IndexedDB 흉내(필요한 만큼만) — 연결 닫힘(InvalidStateError)·강제 종료(AbortError)·꽉 참을 낼 수 있다 */
function fakeIndexedDB() {
  const data = { keys: new Map(), rows: new Map(), meta: new Map() };
  const ctl = { opens: 0, conns: [], next: null };
  const later = (fn) => setTimeout(fn, 0);
  const rowKey = (v) => JSON.stringify([v.uid, v.id]);
  function connection() {
    const db = {
      closed: false,
      onversionchange: null,
      onclose: null,
      objectStoreNames: { contains: () => true },
      close() {
        db.closed = true;
      },
      transaction() {
        if (db.closed) throw new DOMException("The database connection is closing.", "InvalidStateError");
        const staged = [];
        const t = { error: null, oncomplete: null, onerror: null, onabort: null, done: false, pending: 0 };
        const finish = (abortWith) => {
          if (t.done) return;
          t.done = true;
          if (abortWith !== undefined) {
            t.error = abortWith;
            later(() => t.onabort?.());
          } else {
            for (const f of staged) f();
            later(() => t.oncomplete?.());
          }
        };
        t.abort = () => finish(null);
        const fault = ctl.next;
        ctl.next = null;
        const settle = () => {
          if (t.pending > 0 || t.done) return;
          later(() => {
            if (t.pending > 0 || t.done) return;
            if (fault === "forced") {
              // 브라우저가 연결을 강제로 끊음 — 트랜잭션은 AbortError 로 중단, 그 뒤 close 이벤트
              db.closed = true;
              finish(new DOMException("Connection to Indexed Database server lost", "AbortError"));
              later(() => db.onclose?.());
            } else if (fault === "quota") finish(new DOMException("quota", "QuotaExceededError"));
            else finish();
          });
        };
        const req = (fn) => {
          const r = { result: undefined, onsuccess: null };
          t.pending++;
          later(() => {
            if (t.done) return;
            r.result = fn();
            r.onsuccess?.();
            t.pending--;
            settle();
          });
          return r;
        };
        t.objectStore = (name) => {
          const m = data[name];
          return {
            get: (key) => req(() => m.get(name === "rows" ? JSON.stringify(key) : key)),
            put: (v, key) => {
              staged.push(() => m.set(name === "rows" ? rowKey(v) : key, name === "rows" ? { ...v } : v));
              return req(() => undefined);
            },
            delete: (key) => {
              staged.push(() => m.delete(key));
              return req(() => undefined);
            },
            index: () => ({ getAll: (uid) => req(() => [...m.values()].filter((v) => v.uid === uid).map((v) => ({ ...v }))) }),
          };
        };
        return t;
      },
    };
    return db;
  }
  const indexedDB = {
    open() {
      const r = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      later(() => {
        ctl.opens++;
        r.result = connection();
        ctl.conns.push(r.result);
        r.onsuccess?.();
      });
      return r;
    },
  };
  return { indexedDB, data, ctl };
}

test("26. IndexedDB 연결이 끊겨도 다시 열어 저장한다(닫힌 연결·강제 종료는 한 번 더, 우리 오류·꽉 참은 그대로)", async () => {
  const fake = fakeIndexedDB();
  const had = globalThis.indexedDB;
  globalThis.indexedDB = fake.indexedDB;
  try {
    const st = idbDiaryStorage();
    const row = (id, body) => ({ id, day: D, sealed: body, created_at: "x", updated_at: "x", deleted_at: null, ver: null, synced_at: null, dirty: true });
    await st.updateRow("u", "a", () => row("a", "첫 글"));
    assert.equal(fake.ctl.opens, 1);
    // 연결이 닫힘(iOS 'Connection lost'·개발자 도구 등) — 다음 저장은 새로 열어서
    fake.ctl.conns[0].close();
    await st.updateRow("u", "b", () => row("b", "닫힌 뒤 쓴 글"));
    assert.equal(fake.ctl.opens, 2);
    assert.equal((await st.getRow("u", "b")).sealed, "닫힌 뒤 쓴 글");
    // 강제 종료로 트랜잭션이 중단 — 커밋 안 됐으니 새 연결로 한 번 더(한 번만 적힘)
    fake.ctl.next = "forced";
    let calls = 0;
    await st.updateRow("u", "c", (cur) => {
      calls++;
      return row("c", cur ? "두 번 적힘" : "강제 종료 뒤 쓴 글");
    });
    assert.equal(calls, 2);
    assert.equal((await st.getRow("u", "c")).sealed, "강제 종료 뒤 쓴 글");
    assert.equal(fake.ctl.opens, 3);
    // 꽉 참 — 다시 해도 소용없으니 그대로 던진다
    fake.ctl.next = "quota";
    await assert.rejects(() => st.updateRow("u", "d", () => row("d", "x")), (e) => e.name === "QuotaExceededError");
    // 우리 콜백이 던진 것도 그대로(다시 하지 않음)
    let n = 0;
    await assert.rejects(
      () =>
        st.updateRow("u", "e", () => {
          n++;
          throw new Error("콜백 오류");
        }),
      /콜백 오류/,
    );
    assert.equal(n, 1);
    assert.deepEqual((await st.rows("u")).map((r) => r.id).sort(), ["a", "b", "c"]);
  } finally {
    if (had === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = had;
  }
});

/** 고장 낼 수 있는 저장소 — ctl.broken 동안 쓰기가 연결 끊김으로 실패 */
function flaky(base, ctl) {
  const lost = () => new DOMException("The database connection is closing.", "InvalidStateError");
  return {
    ...base,
    scope: base.scope,
    async updateRow(u, id, fn) {
      if (ctl.broken) throw lost();
      return base.updateRow(u, id, fn);
    },
    async putMeta(u, n, v) {
      if (ctl.broken) throw lost();
      return base.putMeta(u, n, v);
    },
  };
}

test("27. 기기 저장이 안 돼도(서버 모드) 글은 서버에 올라가고, 저장소가 돌아오면 기기에도 옮겨 적는다", async () => {
  const uid = await newUser();
  const base = memoryDiaryStorage();
  const ctl = { broken: false };
  const A = await ready(uid, { storage: flaky(base, ctl) });
  ctl.broken = true;
  const id = A.eng.save({ day: D, body: "저장소가 고장 난 사이에 쓴 글" }).id;
  await A.eng.settle();
  assert.match(A.snap().error, /이 기기 저장소에 일기를 쓰지 못했어요/);
  assert.doesNotMatch(A.snap().error, /공간/);
  await A.eng.flush();
  const srv = await h.entries(uid);
  assert.equal(srv.length, 1, "인터넷은 되니 서버엔 올라감");
  assert.equal(A.snap().pending, 0);
  assert.equal(await base.getRow(uid, id), null, "기기엔 아직 없음");
  // 서버에 올린 뒤 더 고쳐도 판(ver)을 따라간다 — 충돌 사본이 생기지 않음
  await write(A, { id, body: "저장소가 고장 난 사이에 쓴 글 — 더", base: { body: "저장소가 고장 난 사이에 쓴 글" } });
  await A.eng.flush();
  assert.equal((await h.entries(uid)).length, 1);
  assert.equal((await h.entries(uid))[0].ver, 2);
  // 저장소가 돌아옴 — 다음 저장(또는 타이머·화면 복귀)에 기기에도 옮겨 적는다
  ctl.broken = false;
  A.eng.flushSoon();
  await A.eng.settle();
  const kept = await base.getRow(uid, id);
  assert.equal(kept?.sealed, (await h.entries(uid))[0].sealed);
  assert.equal(kept.dirty, false);
  assert.equal(A.snap().error, null);
  // 새로고침해도 그대로
  const A2 = device(uid, { storage: base });
  await A2.eng.settle();
  assert.equal(entry(A2, id).body, "저장소가 고장 난 사이에 쓴 글 — 더");
});

test("28. 기기 모드에서 저장이 실패하면 '저장 안 됨'으로 남고, 저장소가 돌아오면 다시 저장한다", async () => {
  const base = memoryDiaryStorage();
  const ctl = { broken: false };
  const eng = new DiaryEngine({ uid: "local", mode: "device", remote: null, storage: flaky(base, ctl), onChange: () => {} });
  eng.start();
  engines.push(eng);
  await eng.settle();
  ctl.broken = true;
  const a = eng.save({ day: D, body: "끊긴 사이에 쓴 글" }).id;
  await eng.settle();
  assert.equal(eng.snapshot().pending, 1);
  assert.equal(eng.snapshot().entries[a].dirty, true);
  assert.match(eng.snapshot().error, /다시 시도/);
  ctl.broken = false;
  // 다른 글을 저장하면(또는 화면 복귀·타이머) 못 한 저장도 같이 다시
  eng.save({ day: D, body: "돌아온 뒤 쓴 글" });
  await eng.settle();
  assert.equal(eng.snapshot().pending, 0);
  assert.equal(eng.snapshot().error, null);
  const again = new DiaryEngine({ uid: "local", mode: "device", remote: null, storage: base, onChange: () => {} });
  again.start();
  engines.push(again);
  await again.settle();
  assert.deepEqual(diaryOn(again.snapshot(), D).map((e) => e.body).sort(), ["끊긴 사이에 쓴 글", "돌아온 뒤 쓴 글"]);
});

/** 같은 기기의 다른 탭 — 저장소 쓰기를 느리게 할 수 있다 */
function slowTab(storage, ms) {
  const o = { on: false };
  return [
    {
      ...storage,
      scope: storage.scope,
      async updateRow(u, id, fn) {
        if (o.on) await new Promise((r) => setTimeout(r, ms));
        return storage.updateRow(u, id, fn);
      },
    },
    o,
  ];
}

test("29. 두 탭 — 한 탭이 그 글로 바쁠 때 온 알림도 놓치지 않고, 다음 저장이 다른 탭 글을 덮어쓰지 않는다", async () => {
  const uid = await newUser();
  const shared = memoryDiaryStorage();
  const T1 = await ready(uid, { storage: shared });
  const [s2, slow] = slowTab(shared, 80);
  const T2 = await ready(uid, { storage: s2 });
  const X = await write(T1, { body: "바탕" });
  await T1.eng.flush();
  await T1.eng.settle();
  await until(() => entry(T2, X)?.body === "바탕", "탭2 에 있음");
  T2.remote.setOffline(true);
  T2.eng.save({ id: X, day: D, mood: 3 });
  await T2.eng.settle();
  T2.remote.setOffline(false);
  slow.on = true;
  const f2 = T2.eng.flush(); // 올라감 → markUploaded 가 느림(탭2 가 X 로 바쁨)
  await until(() => T2.remote.count("pushEntry") > 0 && T2.eng["chains"].has(X), "탭2 바쁨");
  T1.remote.setOffline(true);
  T1.eng.save({ id: X, day: D, body: "바탕 + 탭1의 중요한 글", base: { body: "바탕" } });
  await T1.eng.settle();
  T1.remote.setOffline(false);
  await f2;
  slow.on = false;
  await T2.eng.settle();
  assert.equal(entry(T2, X).body, "바탕 + 탭1의 중요한 글", "탭2 화면도 따라옴");
  const shown = entry(T2, X).body;
  T2.eng.save({ id: X, day: D, body: shown + " + 탭2", base: { body: shown } });
  await T2.eng.settle();
  await T1.eng.settle();
  await T2.eng.flush();
  await T1.eng.flush();
  await T1.eng.settle();
  await T2.eng.settle();
  const server = await h.entries(uid);
  assert.equal(server.length, 1);
  const A = await ready(uid);
  assert.deepEqual(bodies(A), ["바탕 + 탭1의 중요한 글 + 탭2"]);
  assert.equal(entry(A, X).mood, 3);
});

test("30. 두 탭이 같은 글을 거의 동시에 — 늦은 탭의 저장은 덮어쓰지 않고 합친다(기분만 vs 본문만), 둘 다 고친 칸이면 사본", async () => {
  const uid = await newUser();
  const shared = memoryDiaryStorage();
  const slowAll = (storage, ms) => ({
    ...storage,
    scope: storage.scope,
    async getRow(u, id) {
      await new Promise((r) => setTimeout(r, ms));
      return storage.getRow(u, id);
    },
    async updateRow(u, id, fn) {
      await new Promise((r) => setTimeout(r, ms));
      return storage.updateRow(u, id, fn);
    },
  });
  const T1 = await ready(uid, { storage: shared });
  const T2 = await ready(uid, { storage: slowAll(shared, 60) });
  const X = await write(T1, { body: "바탕" });
  await T1.eng.flush();
  await T1.eng.settle();
  await T2.eng.settle();
  await until(() => entry(T2, X)?.body === "바탕", "탭2 에 있음");
  T2.eng.save({ id: X, day: D, mood: 3 }); // 느린 탭 — 기분만
  await new Promise((r) => setTimeout(r, 5));
  T1.eng.save({ id: X, day: D, body: "바탕 + 탭1", base: { body: "바탕" } }); // 빠른 탭 — 본문만
  await T1.eng.settle();
  await T2.eng.settle();
  await until(() => entry(T1, X)?.mood === 3 && entry(T2, X)?.body === "바탕 + 탭1", "합쳐짐");
  assert.equal(entry(T1, X).body, "바탕 + 탭1");
  assert.equal(entry(T2, X).mood, 3);
  assert.equal(Object.keys(T1.snap().entries).length, 1, "사본 없음");
  // 같은 칸(본문)을 두 탭이 다르게 — 늦은 쪽은 사본으로, 둘 다 남는다
  T2.eng.save({ id: X, day: D, body: "탭2 본문", base: { body: "바탕 + 탭1" } });
  await new Promise((r) => setTimeout(r, 5));
  T1.eng.save({ id: X, day: D, body: "탭1 본문", base: { body: "바탕 + 탭1" } });
  await T1.eng.settle();
  await T2.eng.settle();
  await T1.eng.settle();
  await until(() => bodies(T1).length === 2 && bodies(T2).length === 2, "둘 다 남음");
  assert.deepEqual(bodies(T1), ["탭1 본문", "탭2 본문"]);
  assert.deepEqual(bodies(T2), ["탭1 본문", "탭2 본문"]);
});

test("31. 올라갔는데 답이 끊긴 뒤 더 쓰거나 지워도 — 내 것과의 충돌로 보지 않는다(사본 없음, 지운 건 지운 채)", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  A.remote.setOffline(true);
  const X = await write(A, { body: "첫 초안" });
  A.remote.setOffline(false);
  A.remote.afterCommitThrow("pushEntry");
  await A.eng.flush();
  assert.equal((await h.entries(uid)).length, 1);
  A.remote.setOffline(true);
  await write(A, { id: X, body: "첫 초안, 그리고 더", base: { body: "" } });
  A.remote.setOffline(false);
  await A.eng.flush();
  await A.eng.settle();
  assert.deepEqual(bodies(A), ["첫 초안, 그리고 더"]);
  assert.equal(A.snap().pending, 0);
  const sx = (await h.entries(uid)).filter((e) => e.day === D);
  assert.equal(sx.length, 1);
  assert.equal(sx[0].ver, 2);

  // 지우기
  A.remote.setOffline(true);
  const Y = await write(A, { body: "지울 글" });
  A.remote.setOffline(false);
  A.remote.afterCommitThrow("pushEntry");
  await A.eng.flush();
  A.remote.setOffline(true);
  assert.equal(A.eng.remove(Y), true);
  await A.eng.settle();
  A.remote.setOffline(false);
  await A.eng.flush();
  await A.eng.settle();
  assert.ok(entry(A, Y).deleted_at, "지운 채");
  assert.ok((await h.entries(uid)).find((e) => e.id === Y).deleted_at, "서버도 지움");
  assert.equal(A.snap().pending, 0);
});

test("32. 폰의 두 탭이 같은 충돌을 동시에 풀어도 사본은 하나", async () => {
  const uid = await newUser();
  const B = await ready(uid); // 노트북
  const shared = memoryDiaryStorage();
  const T1 = await ready(uid, { storage: shared });
  const T2 = await ready(uid, { storage: shared });
  const X = await write(B, { body: "오늘" });
  await B.eng.flush();
  await T1.eng.pull();
  await T2.eng.pull();
  await T1.eng.settle();
  await T2.eng.settle();
  T1.remote.setOffline(true);
  T2.remote.setOffline(true);
  await write(T1, { id: X, body: "오늘 — 폰", base: { body: "오늘" } });
  await T2.eng.settle();
  await until(() => entry(T2, X)?.body === "오늘 — 폰", "탭2 도 봄");
  await write(B, { id: X, body: "오늘 — 노트북", base: { body: "오늘" } });
  await B.eng.flush();
  T1.remote.setOffline(false);
  T2.remote.setOffline(false);
  T1.eng.onOnline();
  T2.eng.onOnline();
  await T1.eng.settle();
  await T2.eng.settle();
  await T1.eng.flush();
  await T2.eng.flush();
  await T1.eng.settle();
  await T2.eng.settle();
  await B.eng.pull();
  assert.deepEqual(bodies(B), ["오늘 — 노트북", "오늘 — 폰"]);
  assert.equal((await h.entries(uid)).length, 2);
  assert.deepEqual(bodies(T1), ["오늘 — 노트북", "오늘 — 폰"]);
  assert.deepEqual(bodies(T2), ["오늘 — 노트북", "오늘 — 폰"]);
});

test("33. 서버 일시 장애(503·토큰 만료)는 실패 횟수에 안 센다 — 1분 장애 뒤에도 다 올라간다. 멈춘 글은 켤 때·다시 연결될 때 다시", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  A.remote.setOffline(true);
  await write(A, { body: "하나" });
  await write(A, { body: "둘" });
  A.remote.setOffline(false);
  A.remote.fail("pushEntry", { status: 503, message: "no healthy upstream" }, { times: 3 });
  A.remote.fail("pushEntry", { status: 401, code: "PGRST301", message: "JWT expired" }, { times: 3 });
  for (let i = 0; i < 6; i++) await A.eng.flush();
  assert.ok((await A.storage.rows(uid)).every((r) => (r.tries ?? 0) === 0), "일시 장애는 안 셈");
  await A.eng.flush();
  assert.equal((await h.entries(uid)).length, 2);
  assert.equal(A.snap().pending, 0);

  // 정말 5번 실패해서 멈춘 글(지운 글 포함)도 다시 연결되거나 새로 켜면 다시 해 본다 — 지우기(wipe)도 막히지 않게
  const Z = await write(A, { body: "멈출 글" });
  await A.eng.flush();
  A.remote.setOffline(true);
  assert.equal(A.eng.remove(Z), true);
  await A.eng.settle();
  A.remote.setOffline(false);
  A.remote.fail("pushEntry", "error", { times: Infinity, when: (r) => r.id === Z });
  for (let i = 0; i < 8; i++) await A.eng.flush();
  assert.equal((await A.storage.getRow(uid, Z)).tries, 5);
  assert.equal(await A.eng.wipe(), false, "아직 못 올림");
  A.remote.clearFaults();
  A.eng.onOnline();
  await A.eng.settle();
  assert.ok((await h.entries(uid)).find((e) => e.id === Z).deleted_at, "다시 연결되면 올라감");
  assert.equal(A.snap().pending, 0);
  // 새로 켤 때도
  const B = await ready(uid);
  B.remote.setOffline(true);
  const W = await write(B, { body: "새로 켜면 다시" });
  B.remote.setOffline(false);
  B.remote.fail("pushEntry", "error", { times: 5 });
  for (let i = 0; i < 6; i++) await B.eng.flush();
  assert.equal((await B.storage.getRow(uid, W)).tries, 5);
  const B2 = device(uid, { storage: B.storage });
  await B2.eng.settle();
  assert.equal(B2.snap().pending, 0);
  assert.ok((await h.entries(uid)).some((e) => e.id === W));
  // 영영 안 올라가는 글이 있어도 화면이 확인을 받으면 지울 수 있다
  const C = await ready(uid);
  C.remote.setOffline(true);
  await write(C, { body: "못 올라감" });
  assert.equal(await C.eng.wipe(), false);
  assert.equal(await C.eng.wipe({ force: true }), true);
  assert.deepEqual(await C.storage.rows(uid), []);
});

test("34. 오류 분류 — 5xx·429·401·연결 오류는 '다시 하면 됨', 제약 위반·권한은 그 글만의 문제", () => {
  const retry = [
    [{ message: "no healthy upstream" }, 503],
    [{ message: "Bad gateway" }, 502],
    [{ message: "Internal" }, 500],
    [{ message: "rate" }, 429],
    [{ message: "JWT expired", code: "PGRST301" }, 401],
    [{ message: "timeout" }, 408],
    [{ message: "FetchError: x" }, 0],
    [{ message: "could not connect", code: "PGRST001" }, undefined],
    [{ message: "canceling statement", code: "57014" }, undefined],
    [new TypeError("Failed to fetch"), undefined],
  ];
  for (const [e, st] of retry) assert.ok(isNetworkError(toError(e, st)), JSON.stringify([e.message, st]));
  const stop = [
    [{ message: "violates check constraint", code: "23514" }, 400],
    [{ message: "new row violates row-level security policy", code: "42501" }, 403],
    [{ message: "invalid input syntax", code: "22P02" }, 400],
  ];
  for (const [e, st] of stop) assert.ok(!isNetworkError(toError(e, st)), JSON.stringify([e.message, st]));
});

test("35. 비밀번호 바꾸기의 열쇠 올리기가 실제로 됐는데 답만 끊김 — 바꾼 기기는 새 열쇠를 버리지 않고 그대로 열려 있다", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  await write(A, { body: "바꾸기 전 글" });
  await A.eng.flush();
  A.remote.afterCommitThrow("casKeyRow");
  const res = await A.eng.changePassword(PW2, async () => {
    h.setPassword(uid, PW2);
    return { error: null };
  });
  assert.equal(res.error, null);
  await A.eng.settle();
  A.eng.onOnline();
  await A.eng.settle();
  const ring = await ringOf(A);
  const row = await h.keyRow(uid);
  assert.equal(ring.current, row.kid);
  assert.ok(ring.keys[row.kid]);
  assert.equal(ring.pending, null);
  assert.equal(A.snap().state.kind, "ready");
  await write(A, { body: "바꾼 뒤 글" });
  await A.eng.flush();
  const C = await ready(uid, { pw: PW2 });
  assert.deepEqual(bodies(C), ["바꾸기 전 글", "바꾼 뒤 글"]);

  // 다른 곳에서 비밀번호가 바뀐 뒤 열쇠 가진 기기가 새 비밀번호로 다시 감쌈(held) — 그 답이 끊겨도 "ok", 새 열쇠를 쥔다
  h.setPassword(uid, PW);
  A.remote.afterCommitThrow("casKeyRow");
  assert.equal(await A.eng.unlock(PW), "ok");
  const r2 = await h.keyRow(uid);
  assert.equal((await ringOf(A)).current, r2.kid);
  assert.equal(A.snap().state.kind, "ready");

  // 새로 시작(resetKey)의 답이 끊겨도
  h.setPassword(uid, PW2);
  const K = device(uid);
  await K.eng.settle();
  K.remote.afterCommitThrow("casKeyRow");
  assert.equal(await K.eng.reset(PW2), "ok");
  assert.equal((await ringOf(K)).current, (await h.keyRow(uid)).kid);
  assert.equal(K.snap().state.kind, "ready");
});

test("36. 저장소를 못 읽는 기기에서 '이 기기에서 지우기' — 지우지 못했으면 성공이라고 하지 않는다", async () => {
  const uid = await newUser();
  const base = memoryDiaryStorage();
  const A = await ready(uid, { storage: base });
  await write(A, { body: "남아 있는 글" });
  await A.eng.flush();
  const broken = {
    ...base,
    scope: base.scope,
    async getKeyring() {
      throw new DOMException("Internal error opening backing store", "UnknownError");
    },
    async wipe() {
      throw new DOMException("Connection to Indexed Database server lost", "UnknownError");
    },
  };
  const B = device(uid, { storage: broken });
  await B.eng.settle();
  assert.equal(B.snap().state.kind, "unsupported");
  assert.equal(await B.eng.wipe(), false);
  assert.match(B.snap().error, /지우지 못했어요/);
  assert.ok(await base.getKeyring(uid), "열쇠가 남아 있다");
  // 지울 수 있으면 unsupported 여도 지운다
  const C = device(uid, { storage: { ...broken, wipe: (u) => base.wipe(u) } });
  await C.eng.settle();
  assert.equal(await C.eng.wipe(), true);
  assert.equal(await base.getKeyring(uid), null);
  assert.deepEqual(await base.rows(uid), []);
});

test("37. 저장소가 안 되는 기기에서 비밀번호를 바꿔도 — 열쇠 가진 기기가 다시 감싸도록 표시한다", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  await write(A, { body: "A의 글" });
  await A.eng.flush();
  const base = memoryDiaryStorage();
  const C = device(uid, {
    storage: {
      ...base,
      scope: base.scope,
      async getKeyring() {
        throw new DOMException("Internal error opening backing store", "UnknownError");
      },
    },
  });
  await C.eng.settle();
  assert.equal(C.snap().state.kind, "unsupported");
  const res = await C.eng.changePassword(PW2, async () => {
    h.setPassword(uid, PW2);
    return { error: null };
  });
  assert.equal(res.error, null);
  assert.equal((await h.keyRow(uid)).needs_rewrap, true);
  await A.eng.refresh();
  assert.deepEqual(A.snap().state, { kind: "ready", weak: false, repair: "rewrap" });
  assert.equal(await A.eng.unlock(PW2), "ok");
  assert.equal((await h.keyRow(uid)).needs_rewrap, false);
  const N = await ready(uid, { pw: PW2 });
  assert.deepEqual(bodies(N), ["A의 글"]);
});

test("38. 지우는 동안 돌던 받기·실시간이 늦게 끝나도 지운 기기에 잠긴 글·커서를 다시 적지 않는다", async () => {
  const uid = await newUser();
  const A = await ready(uid);
  for (const b of ["하나", "둘", "셋"]) await write(A, { body: b });
  await A.eng.flush();
  const remote = h.remote(uid);
  const C = await ready(uid, { remote });
  const fire = realtime(C);
  // 느린 받기 시작
  let release;
  const gate = new Promise((r) => (release = r));
  const realPull = remote.pullEntries;
  remote.pullEntries = async (...a) => {
    const rows = await realPull(...a);
    await gate;
    return rows;
  };
  await C.storage.putMeta(uid, "cursor", "2000-01-01T00:00:00Z");
  C.eng["cursor"] = null;
  const p = C.eng.pull();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await C.eng.wipe(), true);
  assert.deepEqual(await C.storage.rows(uid), []);
  release();
  await p;
  // 실시간 알림도 지운 뒤에 옴
  await fire((await h.entries(uid))[0]);
  await C.eng.settle();
  assert.deepEqual(await C.storage.rows(uid), []);
  assert.equal(await C.storage.getMeta(uid, "cursor"), null);
  assert.equal(await C.storage.getKeyring(uid), null);
  assert.deepEqual(C.snap().entries, {});
});

test("39. 앱을 켤 때 일정 등의 밀린 변경은 일기 받기(IndexedDB)를 기다리지 않고 올라간다", async () => {
  const saved = {};
  for (const k of ["window", "document", "localStorage", "navigator"]) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true, writable: true });
  const ls = new Map();
  globalThis.localStorage = {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => ls.set(k, String(v)),
    removeItem: (k) => ls.delete(k),
  };
  const timers = new Set();
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    setTimeout: (f, ms) => {
      const t = setTimeout(f, ms);
      timers.add(t);
      return t;
    },
    clearTimeout: (t) => clearTimeout(t),
    setInterval: (f, ms) => {
      const t = setInterval(f, ms);
      timers.add(t);
      return t;
    },
    clearInterval: (t) => clearInterval(t),
  };
  globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" };
  const upserts = [];
  // supabase-js 흉내 — 무엇이든 이어 붙일 수 있고, 기다리면 빈 결과
  const chain = (table) => {
    const q = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === "then") return (ok) => ok({ data: [], error: null, status: 200 });
          if (prop === "upsert")
            return (rows) => {
              upserts.push({ table, rows });
              return q;
            };
          return () => q;
        },
      },
    );
    return q;
  };
  const sb = {
    from: (t) => chain(t),
    channel: () => {
      const ch = { on: () => ch, subscribe: () => ch };
      return ch;
    },
    removeChannel: async () => {},
    auth: { getSession: async () => ({ data: { session: null } }) },
  };
  const uid = randomUUID();
  const scope = uid;
  const now = new Date().toISOString();
  ls.set(
    `must:v1:${scope}:db`,
    JSON.stringify({
      profile: { id: uid, timezone: "Asia/Seoul", grace_min: 10, settings: {}, updated_at: now },
      categories: { c1: { id: "c1", name: "작업", color: "#000", sort: 0, created_at: now, updated_at: now, deleted_at: null } },
    }),
  );
  ls.set(
    `must:v1:${scope}:outbox`,
    JSON.stringify([{ table: "tasks", id: "t1", mode: "upsert", row: { id: "t1", title: "밀린 일정", updated_at: now }, tries: 0 }]),
  );
  const { PlannerStore } = await import("../src/lib/store.ts");
  const hang = memoryDiaryStorage();
  // IndexedDB 가 멈춤 — 일기 엔진은 영영 켜지지 않는다
  const stuck = { ...hang, scope: hang.scope, getKeyring: () => new Promise(() => {}) };
  const st = new PlannerStore(scope, uid, sb, "cloud", stuck);
  try {
    st.start();
    await until(() => upserts.some((u) => u.table === "tasks"), "일정 올리기", 1500);
  } finally {
    st.dispose();
    for (const t of timers) clearTimeout(t);
    for (const [k, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  }
});

// 일기 암호화 단위 테스트 — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import * as C from "../src/lib/diaryCrypto.ts";

const uid = "aaaaaaaa-0000-4000-8000-000000000001";
const uid2 = "bbbbbbbb-0000-4000-8000-000000000002";
const id = "eeeeeeee-0000-4000-8000-000000000001";
const id2 = "eeeeeeee-0000-4000-8000-000000000002";
const day = "2026-10-08";
// DB 의 CHECK 와 같은 모양
const DB_SEALED = /^v1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/;
const DB_WRAPPED = /^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{64}$/;

const fixture = async () => {
  const dek = await C.generateDek();
  const kid = C.newKid();
  return { dek, kid, keys: { [kid]: dek } };
};

test("잠그고 열기 — 본문·기분 그대로", async () => {
  const { dek, kid, keys } = await fixture();
  assert.equal(kid.length, 22);
  assert.equal(C.newSalt().length, 22);
  for (const p of [
    { body: "오늘은 바다를 봤다 🌊\n둘째 줄", mood: 4 },
    { body: "", mood: null },
    { body: "기분만", mood: 5 },
    { body: "x".repeat(3000), mood: 1 },
  ]) {
    const s = await C.seal(p, dek, kid, uid, id, day);
    assert.match(s, DB_SEALED);
    assert.equal(C.sealedKid(s), kid);
    assert.deepEqual(await C.open(s, keys, uid, id, day), p);
  }
  // 같은 글도 매번 다른 암호문(IV 무작위)
  const a = await C.seal({ body: "같은 글", mood: 3 }, dek, kid, uid, id, day);
  const b = await C.seal({ body: "같은 글", mood: 3 }, dek, kid, uid, id, day);
  assert.notEqual(a, b);
});

test("AAD 가 사용자·글 id·날짜·열쇠 id 를 묶는다 — 하나라도 다르면 WrongKey", async () => {
  const { dek, kid, keys } = await fixture();
  const s = await C.seal({ body: "비밀", mood: 2 }, dek, kid, uid, id, day);
  await assert.rejects(C.open(s, keys, uid2, id, day), C.WrongKey);
  await assert.rejects(C.open(s, keys, uid, id2, day), C.WrongKey);
  await assert.rejects(C.open(s, keys, uid, id, "2026-10-09"), C.WrongKey);
  // 같은 열쇠를 다른 kid 로 붙여도(봉투의 kid 바꿔치기) 안 열린다
  const kid2 = C.newKid();
  const relabeled = s.replace(`v1.${kid}.`, `v1.${kid2}.`);
  await assert.rejects(C.open(relabeled, { ...keys, [kid2]: dek }, uid, id, day), C.WrongKey);
  // 한 글자만 바꿔도
  const i = s.length - 10;
  const flipped = s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
  await assert.rejects(C.open(flipped, keys, uid, id, day), C.WrongKey);
  // 다른 열쇠·열쇠 없음·모양이 틀림
  await assert.rejects(C.open(s, { [kid]: await C.generateDek() }, uid, id, day), C.WrongKey);
  await assert.rejects(C.open(s, {}, uid, id, day), C.WrongKey);
  await assert.rejects(C.open("오늘은 기분이 좋았다", keys, uid, id, day), C.WrongKey);
  await assert.rejects(C.open(`v1.${kid}.AAAAAAAAAAAAAAAA.###`, keys, uid, id, day), C.WrongKey);
});

test("길이 — 짧은 글·기분만은 같은 길이(747), 512·1024 경계", async () => {
  const { dek, kid } = await fixture();
  const len = async (p) => (await C.seal(p, dek, kid, uid, id, day)).length;
  const short = await len({ body: "응", mood: null });
  assert.equal(short, 747);
  assert.equal(await len({ body: "", mood: 3 }), 747);
  assert.equal(await len({ body: "가".repeat(150), mood: 5 }), 747);
  // {"b":"…","m":0,"p":""} 의 겉부분은 21바이트 → 본문 491바이트면 딱 512
  assert.equal(C.plainBytes({ body: "a".repeat(491), mood: null }), 512);
  assert.equal(C.pad({ body: "a".repeat(491), mood: 4 }).length, 512);
  assert.equal(await len({ body: "a".repeat(491), mood: 4 }), 747);
  assert.equal(C.pad({ body: "a".repeat(492), mood: null }).length, 1024);
  assert.equal(await len({ body: "a".repeat(492), mood: null }), 1430);
  assert.equal(C.pad({ body: "a".repeat(1003), mood: null }).length, 1024);
  assert.equal(C.pad({ body: "a".repeat(1004), mood: null }).length, 2048);
  // 기분은 한 자리 — 1~5 밖은 '없음'
  assert.equal(C.unpad(C.pad({ body: "x", mood: 9 })).mood, null);
});

test("2만 자 한글은 DB 한도(10만 자) 안, 제어문자 도배는 TooLong", async () => {
  const { dek, kid, keys } = await fixture();
  const big = await C.seal({ body: "가".repeat(20000), mood: 1 }, dek, kid, uid, id, day);
  assert.ok(big.length <= 100000, `${big.length}`);
  assert.match(big, DB_SEALED);
  assert.equal((await C.open(big, keys, uid, id, day)).body.length, 20000);
  assert.throws(() => C.pad({ body: "\u0001".repeat(20000), mood: null }), C.TooLong);
  assert.ok(C.plainBytes({ body: "\u0001".repeat(20000), mood: null }) > C.MAX_PLAIN_BYTES);
  await assert.rejects(C.seal({ body: "a".repeat(70000), mood: null }, dek, kid, uid, id, day), C.TooLong);
});

test("열쇠 감싸기 — DB 모양, 소금·반복 횟수가 AAD 에 묶임, 낮춰치기 거절", async () => {
  const { dek, kid } = await fixture();
  const salt = C.newSalt();
  const kek = await C.deriveKek("비밀번호123", salt, C.ITERATIONS);
  const w = await C.wrapKey(dek, kek, C.wrapAad(uid, kid, salt, C.ITERATIONS));
  assert.match(w, DB_WRAPPED);
  assert.equal(w.length, 81);
  const back = await C.unwrapKey(w, kek, C.wrapAad(uid, kid, salt, C.ITERATIONS));
  const s = await C.seal({ body: "열쇠 확인", mood: null }, dek, kid, uid, id, day);
  assert.equal((await C.open(s, { [kid]: back }, uid, id, day)).body, "열쇠 확인");
  await assert.rejects(C.unwrapKey(w, kek, C.wrapAad(uid, kid, salt, 1_000_000)), C.WrongKey);
  await assert.rejects(C.unwrapKey(w, kek, C.wrapAad(uid, kid, C.newSalt(), C.ITERATIONS)), C.WrongKey);
  await assert.rejects(C.unwrapKey(w, kek, C.wrapAad(uid2, kid, salt, C.ITERATIONS)), C.WrongKey);
  await assert.rejects(C.unwrapKey(w, kek, C.wrapAad(uid, C.newKid(), salt, C.ITERATIONS)), C.WrongKey);
  const wrong = await C.deriveKek("비밀번호124", salt, C.ITERATIONS);
  await assert.rejects(C.unwrapKey(w, wrong, C.wrapAad(uid, kid, salt, C.ITERATIONS)), C.WrongKey);
  // NFC — 조합형으로 쳐도 같은 열쇠
  const nfd = await C.deriveKek("비밀번호123".normalize("NFD"), salt, C.ITERATIONS);
  await C.unwrapKey(w, nfd, C.wrapAad(uid, kid, salt, C.ITERATIONS));
  await assert.rejects(C.deriveKek("x", salt, 1000), C.WrongKey);
  await assert.rejects(C.deriveKek("x", salt, 6_000_000), C.WrongKey);
  await assert.rejects(C.deriveKek("x", salt, 600_000.5), C.WrongKey);
  // ring 항목 AAD
  const old = await C.generateDek();
  const oldKid = C.newKid();
  const rw = await C.wrapKey(old, dek, C.ringAad(uid, oldKid, kid));
  await C.unwrapKey(rw, dek, C.ringAad(uid, oldKid, kid));
  await assert.rejects(C.unwrapKey(rw, dek, C.ringAad(uid, C.newKid(), kid)), C.WrongKey);
});

test("약한 비밀번호 판정", () => {
  for (const pw of ["abc123", "password", "abcdefghij", "1234567890", "ABCDEFGHIJKL", "짧은비번12"]) assert.equal(C.weakPassword(pw), true, pw);
  for (const pw of ["dream-diary-2026", "Abcdefghij", "abcdefghi1", "한글비밀번호입니다1"]) assert.equal(C.weakPassword(pw), false, pw);
});

test("base64url 왕복 0~70 바이트", () => {
  for (let n = 0; n <= 70; n++) {
    const b = crypto.getRandomValues(new Uint8Array(n));
    const s = C.b64u(b);
    assert.match(s, /^[A-Za-z0-9_-]*$/);
    assert.deepEqual(C.unb64u(s), b);
  }
  assert.throws(() => C.unb64u("a+b/"), C.WrongKey);
});

test("일기 파일은 Node 타입 지우기만으로 돈다(브라우저·테스트 같은 코드)", () => {
  const dir = new URL("../src/lib/", import.meta.url);
  const files = readdirSync(dir).filter((f) => /^diary.*\.ts$/.test(f));
  assert.deepEqual(files.sort(), ["diary.ts", "diaryCrypto.ts", "diaryKeys.ts", "diaryRemote.ts", "diaryStorage.ts"]);
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.doesNotThrow(() => stripTypeScriptTypes(src), f);
    assert.ok(!/from\s+["']@\//.test(src), `${f}: @/ 별칭 금지`);
    for (const m of src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)) {
      assert.ok(m[1].startsWith("./") && !/\.[jt]s$/.test(m[1]), `${f}: 값 import 는 상대·확장자 없이만 (${m[1]})`);
    }
  }
  assert.ok(!/^import /m.test(readFileSync(new URL("diaryCrypto.ts", dir), "utf8")), "diaryCrypto.ts 는 import 없음");
});

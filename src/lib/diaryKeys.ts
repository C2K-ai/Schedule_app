// 일기 열쇠의 한살이 — 만들기·풀기·비밀번호 바꾸기·새로 시작.
//   · 일기 열쇠(DEK)는 기기에서 만든다. 서버엔 로그인 비밀번호로 감싼 것(wrapped)만 간다.
//   · 예전 열쇠들은 지금 열쇠로 감싸서 ring 에 둔다 → 지금 열쇠 하나만 풀면 옛 글도 다 열린다.
//   · 서버 행은 rev 가 같을 때만 바꾼다(CAS) → 두 기기가 동시에 바꿔도 한쪽 열쇠가 사라지지 않는다.
//   · 비밀번호를 열쇠 감싸기에 쓰기 전엔 항상 서버(Auth)로 맞는지 확인한다 → 오타가 열쇠가 되지 않게.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ITERATIONS,
  deriveKek,
  generateDek,
  newKid,
  newSalt,
  ringAad,
  supported,
  unwrapKey,
  weakPassword,
  wrapAad,
  wrapKey,
} from "./diaryCrypto";
import { type DiaryRemote, type KeyRow, isNetworkError, supabaseDiaryRemote } from "./diaryRemote";
import { type DiaryStorage, type Keyring, idbDiaryStorage } from "./diaryStorage";

export type Ctx = { uid: string; storage: DiaryStorage; remote: DiaryRemote };
export type UnlockResult = "ok" | "wrong_password" | "old_password" | "old_wrong" | "network";

/** 탭끼리 알림 — 평문은 절대 안 싣는다 */
export type DiaryMsg = { t: "keys" } | { t: "rows"; ids: string[] } | { t: "wipe" };

export const channelName = (uid: string, storage?: DiaryStorage) =>
  `must-diary:${uid}${storage?.scope ? `:${storage.scope}` : ""}`;

/** 같은 기기의 다른 탭(그리고 이 탭의 엔진)에 알린다 */
export function announce(chan: string, msg: DiaryMsg) {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const ch = new BroadcastChannel(chan);
    ch.postMessage(msg);
    ch.close();
  } catch {
    // 못 알려도 다음 새로고침 때 맞춰진다
  }
}

const EMPTY: Keyring = { current: null, keys: {}, weak: false, pending: null };
const MAX_RING = 100;

export async function loadRing(ctx: Ctx): Promise<Keyring> {
  return (await ctx.storage.getKeyring(ctx.uid)) ?? { ...EMPTY, keys: {} };
}

/** 열쇠 꾸러미 저장 — 이미 있는 열쇠는 절대 빼지 않는다(한 트랜잭션에서 합치기). 다른 탭에도 알림 */
export async function saveRing(ctx: Ctx, ring: Keyring) {
  await ctx.storage.updateKeyring(ctx.uid, (cur) => ({ ...ring, keys: { ...(cur?.keys ?? {}), ...ring.keys } }));
  announce(channelName(ctx.uid, ctx.storage), { t: "keys" });
}

/** 보류 중인 비밀번호 바꾸기만 고친다(열쇠는 그대로) */
async function setPending(ctx: Ctx, fn: (p: Keyring["pending"]) => Keyring["pending"]): Promise<Keyring["pending"]> {
  const next = await ctx.storage.updateKeyring(ctx.uid, (cur) => ({
    ...(cur ?? { ...EMPTY, keys: {} }),
    pending: fn(cur?.pending ?? null),
  }));
  return next?.pending ?? null;
}

/** 지금 열쇠로 감싼 예전 열쇠들을 푼다 — 안 풀리는 건 건너뜀 */
export async function openRing(uid: string, row: KeyRow, dek: CryptoKey): Promise<Record<string, CryptoKey>> {
  const out: Record<string, CryptoKey> = { [row.kid]: dek };
  for (const e of Array.isArray(row.ring) ? row.ring : []) {
    if (!e || typeof e.kid !== "string" || typeof e.w !== "string" || out[e.kid]) continue;
    try {
      out[e.kid] = await unwrapKey(e.w, dek, ringAad(uid, e.kid, row.kid));
    } catch {
      // 망가진 항목 — 무시
    }
  }
  return out;
}

/** keys 중 byKid 가 아닌 것들을 by 로 감싼 ring */
async function wrapRing(uid: string, keys: Record<string, CryptoKey>, by: CryptoKey, byKid: string) {
  const ring: KeyRow["ring"] = [];
  for (const [kid, k] of Object.entries(keys)) {
    if (kid === byKid) continue;
    ring.push({ kid, w: await wrapKey(k, by, ringAad(uid, kid, byKid)) });
  }
  // DB 는 100개까지 — 넘치면 가장 오래된 것부터(거의 없을 일)
  return ring.slice(-MAX_RING);
}

/** 새 열쇠 + 새 소금으로 다시 감싸기. 매개변수는 늘 앱의 상수(서버 값은 절대 다시 쓰지 않는다) */
export async function rotation(uid: string, all: Record<string, CryptoKey>, pw: string) {
  const kid = newKid();
  const dek = await generateDek();
  const salt = newSalt();
  const kek = await deriveKek(pw, salt, ITERATIONS);
  const wrapped = await wrapKey(dek, kek, wrapAad(uid, kid, salt, ITERATIONS));
  const ring = await wrapRing(uid, all, dek, kid);
  return { kid, dek, patch: { kid, salt, iterations: ITERATIONS, wrapped, ring, needs_rewrap: false } };
}

/** 이 기기에만 있는 열쇠를 서버 ring 에 보탠다. 보탤 게 없으면 null */
export async function mergePatch(uid: string, row: KeyRow, rowDek: CryptoKey, keys: Record<string, CryptoKey>) {
  const have = new Set([row.kid, ...(row.ring ?? []).map((e) => e.kid)]);
  const missing = Object.keys(keys).filter((k) => !have.has(k));
  if (missing.length === 0) return null;
  const extra: KeyRow["ring"] = [];
  for (const kid of missing) extra.push({ kid, w: await wrapKey(keys[kid], rowDek, ringAad(uid, kid, row.kid)) });
  return { ring: [...(row.ring ?? []), ...extra].slice(-MAX_RING) };
}

async function tryUnwrap(uid: string, row: KeyRow, pw: string): Promise<CryptoKey | null> {
  try {
    // 반복 횟수가 이상하면(낮춰치기) deriveKek 이 WrongKey 를 던진다 → 실패로 친다
    const kek = await deriveKek(pw, row.salt, row.iterations);
    return await unwrapKey(row.wrapped, kek, wrapAad(uid, row.kid, row.salt, row.iterations));
  } catch {
    return null;
  }
}

/** 서버 호출 — 인터넷 문제면 undefined, 다른 오류는 그대로 던짐 */
async function net<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    if (isNetworkError(e)) return undefined;
    throw e;
  }
}

/**
 * 로그인 비밀번호로 일기 열기.
 *  verified: 방금 그 비밀번호로 로그인했으면 true(다시 확인 안 함)
 *  oldPassword: 열쇠가 예전 비밀번호로 감싸여 있을 때 — 풀리면 지금 비밀번호로 옮겨 감싼다
 */
export async function unlockWithPassword(
  ctx: Ctx,
  pw: string,
  o: { verified: boolean; oldPassword?: string },
): Promise<UnlockResult> {
  const { uid, remote } = ctx;
  if (!o.verified) {
    try {
      if ((await remote.verifyPassword(pw)) === "wrong") return "wrong_password";
    } catch {
      return "network";
    }
  }
  const weak = weakPassword(pw);
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await net(remote.getKeyRow());
    if (row === undefined) return "network";
    const ring = await loadRing(ctx);

    if (!row) {
      // 서버에 열쇠가 없다 — 이 기기 열쇠가 있으면 그걸 올리고, 없으면 새로 만든다
      const mine = ring.current ? ring.keys[ring.current] : undefined;
      const kid = mine && ring.current ? ring.current : newKid();
      const dek = mine ?? (await generateDek());
      const salt = newSalt();
      const kek = await deriveKek(pw, salt, ITERATIONS);
      const wrapped = await wrapKey(dek, kek, wrapAad(uid, kid, salt, ITERATIONS));
      const others = await wrapRing(uid, ring.keys, dek, kid);
      const inserted = await net(remote.insertKeyRow({ kid, salt, iterations: ITERATIONS, wrapped, ring: others }));
      if (inserted === undefined) return "network";
      if (!inserted) continue; // 다른 기기가 먼저 만듦 → 그걸 푼다
      await saveRing(ctx, { current: kid, keys: { ...ring.keys, [kid]: dek }, weak, pending: null });
      return "ok";
    }

    const held = ring.keys[row.kid];
    let dek = await tryUnwrap(uid, row, pw);
    let viaOld = false;
    if (!dek && !held && o.oldPassword) {
      dek = await tryUnwrap(uid, row, o.oldPassword);
      if (!dek) return "old_wrong";
      viaOld = true;
    }

    if (dek) {
      const keys = { ...ring.keys, ...(await openRing(uid, row, dek)) };
      if (viaOld) {
        // 예전 비밀번호로 풀었다 → 지금 비밀번호로 옮겨 감싼다(새 열쇠)
        const r = await rotation(uid, keys, pw);
        const res = await net(remote.casKeyRow(row.rev, r.patch));
        if (res === undefined) return "network";
        if (!res) continue;
        await saveRing(ctx, { current: r.kid, keys: { ...keys, [r.kid]: r.dek }, weak, pending: ring.pending });
        return "ok";
      }
      const merge = await mergePatch(uid, row, dek, keys);
      const patch = merge || row.needs_rewrap ? { ...(merge ?? {}), ...(row.needs_rewrap ? { needs_rewrap: false } : {}) } : null;
      if (patch) {
        const res = await net(remote.casKeyRow(row.rev, patch));
        if (res === null) continue;
        // 인터넷 문제면 합치기는 다음에(checkServerKey) — 여는 건 그대로
      }
      await saveRing(ctx, { current: row.kid, keys, weak, pending: ring.pending });
      return "ok";
    }

    if (held) {
      // 서버의 지금 열쇠는 있는데 비밀번호가 안 맞음 = 다른 곳에서 비밀번호가 바뀜 → 확인된 지금 비밀번호로 다시 감싼다
      const all = { ...ring.keys, ...(await openRing(uid, row, held)) };
      const r = await rotation(uid, all, pw);
      const res = await net(remote.casKeyRow(row.rev, r.patch));
      if (res === undefined) return "network";
      if (!res) continue;
      await saveRing(ctx, { current: r.kid, keys: { ...all, [r.kid]: r.dek }, weak, pending: null });
      return "ok";
    }
    return "old_password";
  }
  return "network";
}

/** 비밀번호가 바뀐 뒤(열쇠 없는 기기) — 새 비밀번호로 열어 보고, 안 되면 '다시 감싸 달라' 표시 */
export async function afterPasswordSet(ctx: Ctx, newPw: string): Promise<UnlockResult> {
  const r = await unlockWithPassword(ctx, newPw, { verified: true });
  if (r === "old_password") {
    try {
      await ctx.remote.setNeedsRewrap();
    } catch (e) {
      console.warn("[diary] needs_rewrap 표시 실패", e);
    }
  }
  return r;
}

/** 확인된 비밀번호 바꾸기를 서버에 올린다. 인터넷 문제면 남겨 두고 나중에 */
export async function commitPending(ctx: Ctx): Promise<void> {
  const { uid, remote } = ctx;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ring = await loadRing(ctx);
    const p = ring.pending;
    if (!p || !p.confirmed) return;
    const row = await net(remote.getKeyRow());
    if (row === undefined) return;
    const held = row ? ring.keys[row.kid] : undefined;
    if (!row || row.kid !== p.fromKid || !held) {
      // 그새 다른 기기가 열쇠를 바꿈 — 보통 점검이 이어받는다
      await setPending(ctx, (cur) => (cur?.kid === p.kid ? null : cur));
      return;
    }
    const all = { ...ring.keys, ...(await openRing(uid, row, held)) };
    const others = await wrapRing(uid, all, p.dek, p.kid);
    const res = await net(
      remote.casKeyRow(row.rev, {
        kid: p.kid,
        salt: p.salt,
        iterations: p.iterations,
        wrapped: p.wrapped,
        ring: others,
        needs_rewrap: false,
      }),
    );
    if (res === undefined) return;
    if (res) {
      await saveRing(ctx, { current: p.kid, keys: { ...all, [p.kid]: p.dek }, weak: p.weak, pending: null });
      return;
    }
  }
}

/** 지금 열쇠가 바뀐 비밀번호 */
export type PasswordChange = { error: unknown; next: (() => Promise<unknown>) | null };

/**
 * 로그인 비밀번호 바꾸기(보통 변경·복구 둘 다). update() 가 실제 Auth 비밀번호를 바꾼다.
 * 열쇠가 있는 기기면 새 열쇠를 미리 만들어 '보류'로 저장해 두고, 바꾸기가 성공하면 올린다(next).
 * next 는 돌려주기만 한다 — 부르는 쪽이 기다리지 않고 뒤에서 돌린다.
 */
export async function changePassword(
  ctx: Ctx,
  newPw: string,
  update: () => Promise<{ error: unknown }>,
): Promise<PasswordChange> {
  let prepared: string | null = null;
  try {
    const row = await ctx.remote.getKeyRow();
    const ring = await loadRing(ctx);
    const held = row ? ring.keys[row.kid] : undefined;
    if (row && held) {
      const all = { ...ring.keys, ...(await openRing(ctx.uid, row, held)) };
      const r = await rotation(ctx.uid, all, newPw);
      const pending = {
        fromKid: row.kid,
        kid: r.kid,
        dek: r.dek,
        salt: r.patch.salt,
        iterations: r.patch.iterations,
        wrapped: r.patch.wrapped,
        weak: weakPassword(newPw),
        confirmed: false,
      };
      await setPending(ctx, () => pending);
      prepared = r.kid;
    }
  } catch (e) {
    // 준비 못 해도 비밀번호는 바꾼다 — 그 뒤 새 비밀번호로 열어 보기로
    console.warn("[diary] 열쇠 준비 실패", e);
  }
  let res: { error: unknown };
  try {
    res = await update();
  } catch (e) {
    res = { error: e };
  }
  if (res.error) {
    if (prepared) await setPending(ctx, (cur) => (cur?.kid === prepared ? null : cur)).catch(() => null);
    return { error: res.error, next: null };
  }
  if (prepared) {
    const kid = prepared;
    const p = await setPending(ctx, (cur) => (cur?.kid === kid ? { ...cur, confirmed: true } : cur)).catch(() => null);
    if (p?.kid === kid) return { error: null, next: () => commitPending(ctx) };
  }
  return { error: null, next: () => afterPasswordSet(ctx, newPw) };
}

/**
 * 서버 열쇠 점검 — 보류된 바꾸기 올리기, 모르는 옛 열쇠 받기, 이 기기에만 있는 열쇠 보태기.
 * 돌려줌: 서버 행, 없으면 null, 인터넷 문제면 undefined
 */
export async function checkServerKey(ctx: Ctx): Promise<KeyRow | null | undefined> {
  const { uid, remote } = ctx;
  let ring = await loadRing(ctx);
  if (ring.pending?.confirmed) {
    await commitPending(ctx);
    ring = await loadRing(ctx);
  }
  let row = await net(remote.getKeyRow());
  if (row === undefined) return undefined;
  if (!row) return null;
  const held = ring.keys[row.kid];
  if (!held) return row;
  const opened = await openRing(uid, row, held);
  const keys = { ...ring.keys, ...opened };
  const added = Object.keys(opened).some((k) => !ring.keys[k]);
  const patch = await mergePatch(uid, row, held, keys);
  if (patch) {
    const res = await net(remote.casKeyRow(row.rev, patch));
    if (res) row = res;
  }
  if (added || ring.current !== row.kid) await saveRing(ctx, { ...ring, current: row.kid, keys });
  return row;
}

/** '새로 시작' — 비밀번호 확인 뒤, 이 기기가 가진 열쇠들로 새 열쇠를 만들어 올린다. 글은 하나도 안 지운다 */
export async function resetKey(ctx: Ctx, pw: string): Promise<UnlockResult> {
  const { uid, remote } = ctx;
  try {
    if ((await remote.verifyPassword(pw)) === "wrong") return "wrong_password";
  } catch {
    return "network";
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await net(remote.getKeyRow());
    if (row === undefined) return "network";
    const ring = await loadRing(ctx);
    // 사실 열 수 있는 경우 — 새로 시작할 필요 없이 그냥 연다
    if (row && (ring.keys[row.kid] || (await tryUnwrap(uid, row, pw)))) {
      return unlockWithPassword(ctx, pw, { verified: true });
    }
    const r = await rotation(uid, ring.keys, pw);
    if (row) {
      const res = await net(remote.casKeyRow(row.rev, r.patch));
      if (res === undefined) return "network";
      if (!res) continue;
    } else {
      const { needs_rewrap: _n, ...ins } = r.patch;
      void _n;
      const ok = await net(remote.insertKeyRow(ins));
      if (ok === undefined) return "network";
      if (!ok) continue;
    }
    await saveRing(ctx, { current: r.kid, keys: { ...ring.keys, [r.kid]: r.dek }, weak: weakPassword(pw), pending: null });
    return "ok";
  }
  return "network";
}

/** 로그인 직후(AuthForm) — 방금 맞힌 비밀번호로 이 기기 일기를 바로 연다. 실패해도 로그인은 그대로 */
export async function diaryAfterLogin(
  sb: SupabaseClient | null,
  uid: string,
  pw: string,
  deps?: { storage?: DiaryStorage; remote?: DiaryRemote },
): Promise<UnlockResult | null> {
  if (!supported()) return null;
  try {
    const remote = deps?.remote ?? (sb ? supabaseDiaryRemote(sb, uid) : null);
    if (!remote) return null;
    return await unlockWithPassword({ uid, storage: deps?.storage ?? idbDiaryStorage(), remote }, pw, { verified: true });
  } catch (e) {
    console.warn("[diary] 로그인 뒤 일기 열기 실패", e);
    return null;
  }
}

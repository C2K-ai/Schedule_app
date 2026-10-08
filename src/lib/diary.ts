// 일기 엔진 — 화면은 이것만 본다.
//   쓰기: 메모리(평문) → 기기에서 잠금 → IndexedDB(잠긴 채로) → 서버(잠긴 채로, 5초에 한 번까지)
//   충돌: 서버의 판(ver)을 같이 보낸다. 서버가 버리면(다른 기기가 먼저 고침) 두 글을 다 남긴다 — 내 글은 사본으로.
//   글은 절대 버리지 않는다. 못 올린 글은 표시만 하고 남겨 둔다.
//   TABLES·DB·백업 파일과는 따로 논다(PlannerStore.put 을 쓰지 않음).
import type { RealtimeChannel } from "@supabase/supabase-js";
import { MAX_PLAIN_BYTES, SEALED_RE, generateDek, newKid, open, plainBytes, seal, supported } from "./diaryCrypto";
import {
  type Ctx,
  type DiaryMsg,
  type UnlockResult,
  announce,
  changePassword as changeKeyPassword,
  channelName,
  checkServerKey,
  resetKey,
  unlockWithPassword,
} from "./diaryKeys";
import { type DiaryRemote, type KeyRow, type ServerEntry, isNetworkError } from "./diaryRemote";
import { type DiaryStorage, type Keyring, type StoredRow, idbDiaryStorage } from "./diaryStorage";
import { nowIso, uuid } from "./time";

export type { UnlockResult } from "./diaryKeys";
// 화면(AuthForm·설정)에서 같이 쓰는 것 — 한곳에서 가져가게
export { diaryAfterLogin } from "./diaryKeys";
export { weakPassword } from "./diaryCrypto";

export type DiaryMode = "cloud" | "device" | "off";

export type DiaryState =
  | { kind: "off" }
  | { kind: "unsupported" }
  | { kind: "loading" }
  | { kind: "ready"; weak: boolean; repair: null | "rewrap" | "publish" }
  | { kind: "locked"; why: "first_time" | "need_password" | "key_changed" | "old_password" };

export interface DiaryEntry {
  id: string;
  day: string;
  body: string;
  /** 1~5, 없으면 null */
  mood: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** 이 기기에 아직 열쇠가 없는 글 — 읽기 전용 */
  locked: boolean;
  /** 아직 서버에 안 올라감(기기 모드: 아직 기기에 안 저장됨) */
  dirty: boolean;
  err: string | null;
}

export interface DiarySnap {
  mode: DiaryMode;
  state: DiaryState;
  /** 지운 글(deleted_at)도 들어 있다 — 화면은 diaryOn/diaryList 로 거른다 */
  entries: Record<string, DiaryEntry>;
  /** 아직 안 올라간 글 수 */
  pending: number;
  error: string | null;
}

export type SaveInput = { id?: string; day: string; body?: string; mood?: number | null; base?: { body: string } };
export type SaveResult = { ok: true; id: string } | { ok: false; error: "locked" | "too_long" };

export interface DiaryEngineOptions {
  uid: string;
  mode: DiaryMode;
  remote: DiaryRemote | null;
  storage?: DiaryStorage;
  onChange: (s: DiarySnap) => void;
  /** 쓰는 동안 올리는 간격(기본 5초) — 타자 흐름이 서버에 덜 드러나게 */
  uploadDelayMs?: number;
}

export function emptyDiarySnap(mode: DiaryMode): DiarySnap {
  return { mode, state: mode === "off" ? { kind: "off" } : { kind: "loading" }, entries: {}, pending: 0, error: null };
}

const byCreated = (a: DiaryEntry, b: DiaryEntry) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);

/** 그날 글(지운 것 빼고), 쓴 순서대로 */
export function diaryOn(d: DiarySnap, day: string): DiaryEntry[] {
  return Object.values(d.entries)
    .filter((e) => e.day === day && !e.deleted_at)
    .sort(byCreated);
}

/** 모든 글(지운 것 빼고), 최근 날짜부터 */
export function diaryList(d: DiarySnap): DiaryEntry[] {
  return Object.values(d.entries)
    .filter((e) => !e.deleted_at)
    .sort((a, b) => (a.day !== b.day ? (a.day < b.day ? 1 : -1) : byCreated(a, b)));
}

/** 이 기기에서 아직 못 여는 글 수 */
export function diaryLockedCount(d: DiarySnap): number {
  return Object.values(d.entries).filter((e) => e.locked && !e.deleted_at).length;
}

interface Mem {
  id: string;
  day: string;
  body: string;
  mood: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  locked: boolean;
}

type RowLike = Pick<StoredRow, "id" | "day" | "sealed" | "created_at" | "updated_at" | "deleted_at">;

const MAX_TRIES = 5;
const REMOVE_GRACE_MS = 5000;
const PAGE = 500;
const iso = (v: unknown): string => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? String(v ?? "") : new Date(t).toISOString();
};
const normMood = (m: number | null | undefined): number | null =>
  typeof m === "number" && m >= 1 && m <= 5 ? Math.round(m) : null;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: string } | null)?.message ?? e));
const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** Postgres 시각 표기 → 앱의 toISOString() 표기 */
function normEntry(s: ServerEntry): ServerEntry {
  return {
    id: String(s.id),
    day: String(s.day).slice(0, 10),
    sealed: s.sealed,
    ver: Number(s.ver),
    created_at: iso(s.created_at),
    updated_at: iso(s.updated_at),
    deleted_at: s.deleted_at ? iso(s.deleted_at) : null,
    synced_at: String(s.synced_at),
  };
}

const fromServer = (s: ServerEntry): StoredRow => ({
  id: s.id,
  day: s.day,
  sealed: s.sealed,
  created_at: s.created_at,
  updated_at: s.updated_at,
  deleted_at: s.deleted_at,
  ver: s.ver,
  synced_at: s.synced_at,
  dirty: false,
  err: null,
  tries: 0,
});

export class DiaryEngine {
  readonly uid: string;
  readonly mode: DiaryMode;
  private remote: DiaryRemote | null;
  private storage: DiaryStorage;
  private onChange: (s: DiarySnap) => void;
  private uploadDelay: number;
  private chan: string;
  private bc: BroadcastChannel | null = null;
  private started = false;
  private disposed = false;
  private status: "loading" | "unsupported" | "live" = "loading";
  private loaded: Promise<void>;
  private markLoaded: () => void = () => {};

  // 열쇠
  private ring: Keyring | null = null;
  /** 마지막으로 본 서버 열쇠 행. undefined = 모름(오프라인) */
  private row: KeyRow | null | undefined = undefined;
  private keyChecked = false;
  private lastKeyCheck = 0;
  private oldPw = false;
  /** '예전 비밀번호' 상태에서 — 서버 열쇠가 바뀌면 이 비밀번호로 한 번 더 열어 본다(메모리에만) */
  private retry: { pw: string; rev: number | null } | null = null;
  private keyChain: Promise<unknown> = Promise.resolve();

  // 글
  private mem: Record<string, Mem> = {};
  private stored: Record<string, StoredRow> = {};
  private seq: Record<string, number> = {};
  private persistedSeq: Record<string, number> = {};
  /** 이 엔진이 마지막으로 쓴 본문 — '편집 중에 다른 곳에서 바뀜'을 가르는 기준 */
  private mine: Record<string, string> = {};
  /** 갈라져 나온 사본 — 같은 편집기의 다음 저장은 그 사본으로 */
  private forkOf: Record<string, string> = {};
  /** 이 기기에서 지운 글(지운 시각) — 편집기가 닫히며 바로 뒤따라온 저장이 되살리지 않게 */
  private removedHere = new Map<string, number>();
  private chains = new Map<string, Promise<void>>();
  private busy = new Map<string, number>();
  private bg = new Set<Promise<unknown>>();

  // 동기화
  private cursor: string | null = null;
  private flushP: Promise<void> | null = null;
  private flushAgain = false;
  private pullP: Promise<void> | null = null;
  private pullAgain = false;
  private uploadTimer: ReturnType<typeof setTimeout> | null = null;
  private uploadAt = 0;
  private backoff = 2000;
  private error: string | null = null;

  // 화면
  private view: Record<string, DiaryEntry> = {};
  private snap: DiarySnap;
  private snapStale = true;
  private emitQueued = false;

  constructor(o: DiaryEngineOptions) {
    this.uid = o.uid;
    this.mode = o.mode;
    this.remote = o.mode === "cloud" ? o.remote : null;
    this.storage = o.storage ?? idbDiaryStorage();
    this.onChange = o.onChange;
    this.uploadDelay = o.uploadDelayMs ?? 5000;
    this.chan = channelName(this.uid, this.storage);
    this.snap = emptyDiarySnap(o.mode);
    this.loaded = new Promise<void>((r) => (this.markLoaded = r));
  }

  private get ctx(): Ctx {
    return { uid: this.uid, storage: this.storage, remote: this.remote as DiaryRemote };
  }

  // ───────────── 수명 ─────────────
  start() {
    if (this.started || this.disposed) return;
    this.started = true;
    // IndexedDB 를 읽기 전에 먼저 듣는다 — 그 사이 다른 탭이 바꾼 것도 놓치지 않게
    if (this.mode !== "off" && typeof BroadcastChannel !== "undefined") {
      try {
        this.bc = new BroadcastChannel(this.chan);
        this.bc.onmessage = (e: MessageEvent) => this.onMessage(e.data as DiaryMsg);
      } catch {
        this.bc = null;
      }
    }
    this.track(this.boot());
  }

  dispose() {
    this.disposed = true;
    if (this.uploadTimer) clearTimeout(this.uploadTimer);
    this.uploadTimer = null;
    this.bc?.close();
    this.bc = null;
    this.retry = null;
    this.markLoaded();
  }

  private async boot() {
    try {
      if (this.mode === "off") return;
      if (!supported()) {
        this.status = "unsupported";
        return;
      }
      let ring: Keyring | null;
      let rows: StoredRow[];
      try {
        ring = await this.storage.getKeyring(this.uid);
        rows = await this.storage.rows(this.uid);
        this.cursor = await this.storage.getMeta(this.uid, "cursor");
        if (this.mode === "device" && !(ring?.current && ring.keys[ring.current])) {
          // 서버 없는 빌드 — 이 기기 열쇠를 바로 만든다(비밀번호 없음). 다른 탭이 먼저 만들었으면 그걸 쓴다
          const kid = newKid();
          const dek = await generateDek();
          ring = await this.storage.updateKeyring(this.uid, (cur) =>
            cur?.current && cur.keys[cur.current]
              ? null
              : { current: kid, keys: { ...(cur?.keys ?? {}), [kid]: dek }, weak: false, pending: null },
          );
        }
        if (ring?.pending && !ring.pending.confirmed) {
          // 로그인 비밀번호가 바뀌었는지 모르는 채로 끝난 바꾸기 — 버린다
          ring = await this.storage.updateKeyring(this.uid, (cur) =>
            cur?.pending && !cur.pending.confirmed ? { ...cur, pending: null } : null,
          );
        }
      } catch (e) {
        console.warn("[diary] 이 기기 저장소를 못 열었어요", e);
        this.status = "unsupported";
        return;
      }
      if (this.disposed) return;
      this.ring = ring;
      const derived = await Promise.all(rows.map((r) => this.derive(r)));
      rows.forEach((r, i) => {
        if (this.stored[r.id]) return; // 그새 다른 탭 알림으로 먼저 읽음
        this.stored[r.id] = r;
        this.mem[r.id] = derived[i];
      });
      this.status = "live";
    } finally {
      this.markLoaded();
      this.emit();
    }
    if (this.remote && !this.disposed) {
      await this.syncKeys();
      await this.pull();
      await this.flush();
    }
  }

  private track<T>(p: Promise<T>): Promise<T> {
    const q = p.catch((e) => console.warn("[diary]", e));
    this.bg.add(q);
    void q.finally(() => this.bg.delete(q));
    return p;
  }

  /** 테스트용 — 돌고 있는 일(저장·올리기·받기·열쇠)이 다 끝날 때까지 */
  async settle(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      const ps: Promise<unknown>[] = [...this.chains.values(), this.keyChain, ...this.bg];
      if (this.flushP) ps.push(this.flushP);
      if (this.pullP) ps.push(this.pullP);
      await Promise.all(ps.map((p) => p.catch(() => undefined)));
      await new Promise((r) => setTimeout(r, 0));
      if (!this.chains.size && !this.bg.size && !this.flushP && !this.pullP) return;
    }
  }

  // ───────────── 화면용 ─────────────
  snapshot(): DiarySnap {
    if (!this.snapStale) return this.snap;
    this.snapStale = false;
    const entries: Record<string, DiaryEntry> = {};
    let pending = 0;
    for (const [id, m] of Object.entries(this.mem)) {
      const st = this.stored[id];
      const dirty = (!!st?.dirty && !!this.remote) || (this.seq[id] ?? 0) !== (this.persistedSeq[id] ?? 0);
      if (dirty) pending++;
      const err = st?.err ?? null;
      const prev = this.view[id];
      entries[id] =
        prev &&
        prev.day === m.day &&
        prev.body === m.body &&
        prev.mood === m.mood &&
        prev.created_at === m.created_at &&
        prev.updated_at === m.updated_at &&
        prev.deleted_at === m.deleted_at &&
        prev.locked === m.locked &&
        prev.dirty === dirty &&
        prev.err === err
          ? prev
          : { ...m, dirty, err };
    }
    this.view = entries;
    const state = this.stateNow();
    this.snap = {
      mode: this.mode,
      state: JSON.stringify(state) === JSON.stringify(this.snap.state) ? this.snap.state : state,
      entries,
      pending,
      error: this.error,
    };
    return this.snap;
  }

  private emit() {
    this.snapStale = true;
    if (this.emitQueued || this.disposed) return;
    this.emitQueued = true;
    queueMicrotask(() => {
      this.emitQueued = false;
      if (!this.disposed) this.onChange(this.snapshot());
    });
  }

  private stateNow(): DiaryState {
    if (this.mode === "off") return { kind: "off" };
    if (this.status === "unsupported") return { kind: "unsupported" };
    if (this.status === "loading") return { kind: "loading" };
    const ring = this.ring;
    const has = !!(ring?.current && ring.keys[ring.current]);
    const weak = !!ring?.weak;
    if (this.mode === "device") return { kind: "ready", weak: false, repair: null };
    const row = this.row;
    let s: DiaryState;
    if (!has) {
      if (row === undefined && !this.keyChecked) return { kind: "loading" };
      s = { kind: "locked", why: row === null ? "first_time" : "need_password" };
    } else if (row === undefined) s = { kind: "ready", weak, repair: null };
    else if (row === null) s = { kind: "ready", weak, repair: "publish" };
    else if (!ring?.keys[row.kid]) s = { kind: "locked", why: "key_changed" };
    else s = { kind: "ready", weak, repair: row.needs_rewrap ? "rewrap" : null };
    if (this.oldPw && s.kind === "locked") return { kind: "locked", why: "old_password" };
    return s;
  }

  private pendingCount(): number {
    let n = 0;
    const ids = new Set([...Object.keys(this.mem), ...Object.keys(this.stored)]);
    for (const id of ids) {
      if ((this.stored[id]?.dirty && this.remote) || (this.seq[id] ?? 0) !== (this.persistedSeq[id] ?? 0)) n++;
    }
    return n;
  }

  // ───────────── 줄 세우기(글마다 하나씩) ─────────────
  private queue<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(id) ?? Promise.resolve();
    const run = prev.then(fn);
    this.busy.set(id, (this.busy.get(id) ?? 0) + 1);
    const tail: Promise<void> = run
      .then(
        () => undefined,
        (e) => {
          if (!isNetworkError(e)) console.warn("[diary]", id, e);
        },
      )
      .then(() => {
        const n = (this.busy.get(id) ?? 1) - 1;
        if (n > 0) this.busy.set(id, n);
        else this.busy.delete(id);
        if (this.chains.get(id) === tail) this.chains.delete(id);
      });
    this.chains.set(id, tail);
    return run;
  }

  private keyOp<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.keyChain.then(fn);
    this.keyChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async derive(r: RowLike): Promise<Mem> {
    const base = {
      id: r.id,
      day: r.day,
      created_at: r.created_at,
      updated_at: r.updated_at,
      deleted_at: r.deleted_at ?? null,
    };
    try {
      const p = await open(r.sealed, this.ring?.keys ?? {}, this.uid, r.id, r.day);
      return { ...base, body: p.body, mood: p.mood, locked: false };
    } catch {
      return { ...base, body: "", mood: null, locked: true };
    }
  }

  // ───────────── 다른 탭 ─────────────
  private onMessage(m: DiaryMsg) {
    if (this.disposed || !m || typeof m !== "object") return;
    void this.loaded.then(() => {
      if (this.disposed || this.status !== "live") return;
      if (m.t === "keys") {
        void this.reloadRing().then((changed) => {
          if (!changed || !this.remote) return;
          // 다른 탭(로그인 등)이 열쇠를 바꿈 — 서버 열쇠 행도 그새 바뀌었을 수 있으니 다시 본다
          this.row = undefined;
          this.emit();
          return this.syncKeys();
        });
      } else if (m.t === "rows") {
        for (const id of Array.isArray(m.ids) ? m.ids : []) {
          // 이 탭이 그 글로 할 일이 남아 있으면 그쪽이 맞춘다
          if (!this.busy.get(id)) void this.queue(id, () => this.reloadRow(id));
        }
      } else if (m.t === "wipe") {
        this.resetEmpty();
      }
    });
  }

  private async reloadRow(id: string) {
    const row = await this.storage.getRow(this.uid, id);
    if (!row) return;
    const prev = this.stored[id];
    this.stored[id] = row;
    const unsaved = (this.seq[id] ?? 0) !== (this.persistedSeq[id] ?? 0);
    if ((prev?.sealed !== row.sealed || !this.mem[id]) && !unsaved) {
      this.mem[id] = await this.derive(row);
      if (!row.deleted_at) this.removedHere.delete(id);
    }
    this.emit();
  }

  private resetEmpty() {
    this.mem = {};
    this.stored = {};
    this.seq = {};
    this.persistedSeq = {};
    this.mine = {};
    this.forkOf = {};
    this.removedHere.clear();
    this.ring = null;
    this.cursor = null;
    this.oldPw = false;
    this.retry = null;
    this.emit();
  }

  /** 저장된 열쇠 꾸러미 다시 읽기. 바뀌었으면 true */
  private async reloadRing(): Promise<boolean> {
    if (this.status !== "live" || this.disposed) return false;
    let next: Keyring | null;
    try {
      next = await this.storage.getKeyring(this.uid);
    } catch (e) {
      console.warn("[diary] 열쇠 읽기 실패", e);
      return false;
    }
    const before = this.ring;
    this.ring = next;
    const added = Object.keys(next?.keys ?? {}).some((k) => !before?.keys[k]);
    const changed = added || before?.current !== next?.current || before?.weak !== next?.weak;
    if (changed) this.oldPw = false;
    this.emit();
    if (added) await this.reopenLocked();
    return changed;
  }

  /** 새 열쇠가 생겼다 — 잠겨 있던 글을 다시 열어 본다(저장된 내용이 그대로일 때만 바꿈) */
  private async reopenLocked() {
    const jobs: Promise<void>[] = [];
    for (const [id, m] of Object.entries(this.mem)) {
      if (!m.locked) continue;
      const job = this.queue(id, async () => {
        const row = await this.storage.getRow(this.uid, id);
        if (!row) return;
        const plain = await this.derive(row);
        if (plain.locked || !this.mem[id]?.locked) return;
        if (this.stored[id] && this.stored[id].sealed !== row.sealed) return;
        this.stored[id] = row;
        this.mem[id] = plain;
        this.emit();
      });
      jobs.push(job.catch(() => undefined));
    }
    await Promise.all(jobs);
  }

  // ───────────── 열쇠 ─────────────
  /** 서버 열쇠 점검 + 꾸러미 다시 읽기 */
  private async syncKeys(): Promise<void> {
    if (!this.remote || this.disposed) return;
    await this.loaded;
    if (this.status !== "live") return;
    let row: KeyRow | null | undefined;
    try {
      row = await this.keyOp(() => checkServerKey(this.ctx));
    } catch (e) {
      console.warn("[diary] 열쇠 점검 실패", e);
      row = undefined;
    }
    this.lastKeyCheck = Date.now();
    this.keyChecked = true;
    if (row !== undefined) this.row = row;
    await this.reloadRing();
    // '예전 비밀번호' 상태였는데 서버 열쇠가 바뀜(열리는 기기가 다시 감쌈) → 기억해 둔 비밀번호로 한 번 더
    const retry = this.retry;
    if (retry && row) {
      if (retry.rev === null) retry.rev = row.rev;
      else if (row.rev !== retry.rev && !this.ring?.keys[row.kid]) {
        retry.rev = row.rev;
        const r = await this.keyOp(() => unlockWithPassword(this.ctx, retry.pw, { verified: false }));
        if (r === "ok" || r === "wrong_password") this.retry = null;
        if (r === "ok") {
          this.oldPw = false;
          await this.syncKeys();
        }
      }
    }
  }

  private async afterUnlock(r: UnlockResult, pw: string) {
    if (r === "ok") {
      this.oldPw = false;
      this.retry = null;
    }
    await this.syncKeys();
    if (r === "old_password") {
      this.oldPw = true;
      this.retry = { pw, rev: this.row ? this.row.rev : null };
      this.emit();
    }
    if (r === "ok") {
      // 다른 탭 알림이 먼저 열쇠를 읽어 갔어도 — 열기가 끝나면 잠긴 글도 열려 있게
      await this.reopenLocked();
      void this.pull();
      void this.flush();
    }
  }

  /** 로그인 비밀번호로 열기(잠김 카드·다시 감싸기 카드) */
  async unlock(pw: string, o?: { oldPassword?: string }): Promise<UnlockResult> {
    if (this.mode === "device") return "ok";
    if (!this.remote || this.disposed) return "network";
    await this.loaded;
    if (this.status !== "live") return "network";
    let r: UnlockResult;
    try {
      r = await this.keyOp(() => unlockWithPassword(this.ctx, pw, { verified: false, oldPassword: o?.oldPassword }));
    } catch (e) {
      console.warn("[diary] 열기 실패", e);
      return "network";
    }
    await this.afterUnlock(r, pw);
    return r;
  }

  /** '새로 시작' — 새 열쇠. 지금 못 여는 글은 잠긴 채로 남는다(지우지 않음) */
  async reset(pw: string): Promise<UnlockResult> {
    if (this.mode === "device") return "ok";
    if (!this.remote || this.disposed) return "network";
    await this.loaded;
    if (this.status !== "live") return "network";
    let r: UnlockResult;
    try {
      r = await this.keyOp(() => resetKey(this.ctx, pw));
    } catch (e) {
      console.warn("[diary] 새로 시작 실패", e);
      return "network";
    }
    await this.afterUnlock(r, pw);
    return r;
  }

  /**
   * 로그인 비밀번호 바꾸기(설정·복구 둘 다) — update 가 실제로 바꾼다(sb.auth.updateUser).
   * 일기 열쇠도 새 비밀번호로 같이 감싼다(뒤에서). 돌려주는 error 는 update 의 것
   */
  async changePassword(pw: string, update: () => Promise<{ error: unknown }>): Promise<{ error: unknown }> {
    const plain = async () => {
      try {
        return { error: (await update()).error };
      } catch (e) {
        return { error: e };
      }
    };
    if (!this.remote || this.disposed) return plain();
    await this.loaded;
    if (this.status !== "live") return plain();
    const res = await this.keyOp(() => changeKeyPassword(this.ctx, pw, update));
    if (!res.error && res.next) {
      const next = res.next;
      this.track(
        this.keyOp(next).then(async (r) => {
          if (r === "old_password") {
            this.oldPw = true;
            this.retry = { pw, rev: null };
          }
          await this.syncKeys();
        }),
      );
    }
    return { error: res.error };
  }

  /** 시트를 열 때(준비 안 됐으면) — 열쇠·글 다시 맞추기 */
  async refresh(): Promise<void> {
    await this.loaded;
    if (this.status !== "live") return;
    await this.reloadRing();
    if (this.remote) await this.pull();
  }

  // ───────────── 쓰기 ─────────────
  /**
   * 글 저장(메모리 즉시, 기기·서버는 뒤에서).
   *  id 없음 → 새 글. 없는 id → 그 id 로 새 글(편집기가 미리 만든 id).
   *  base: 편집을 시작할 때(또는 마지막 저장 때) 본 본문 — 그새 다른 곳에서 바뀌었으면 사본으로 갈라 둘 다 남긴다.
   *  돌려준 id 가 넘긴 id 와 다르면 사본(또는 새 글)에 썼다는 뜻.
   */
  save(i: SaveInput): SaveResult {
    if (this.stateNow().kind !== "ready") return { ok: false, error: "locked" };
    let id = i.id ?? uuid();
    // 지운 직후 늦게 온 저장(편집기 닫힘·blur)은 무시. 그 뒤의 저장은 아래에서 새 글로 간다
    if (Date.now() - (this.removedHere.get(id) ?? -Infinity) < REMOVE_GRACE_MS) return { ok: true, id };
    let cur: Mem | undefined = this.mem[id];
    if (cur?.locked) return { ok: false, error: "locked" };
    let fork: string | null = null;
    const changedUnder =
      !!cur && !cur.deleted_at && !!i.base && cur.body !== i.base.body && cur.body !== this.mine[id];
    if (cur && (cur.deleted_at || changedUnder)) {
      // 지워졌거나(다른 기기) 편집 중에 바뀜 → 이 편집은 사본으로. 지운 글은 절대 되살리지 않는다
      const f = this.forkOf[id];
      const fc = f ? this.mem[f] : undefined;
      if (f && fc && !fc.deleted_at && !fc.locked && (fc.body === this.mine[f] || fc.body === i.base?.body)) {
        id = f;
        cur = fc;
      } else {
        fork = id;
        id = uuid();
        cur = undefined;
      }
    }
    const body = i.body ?? cur?.body ?? "";
    const mood = normMood(i.mood !== undefined ? i.mood : (cur?.mood ?? null));
    if (cur && body === cur.body && mood === cur.mood) return { ok: true, id };
    if (!cur && body === "" && mood === null) return { ok: true, id };
    if (plainBytes({ body, mood }) > MAX_PLAIN_BYTES) return { ok: false, error: "too_long" };
    if (fork) this.forkOf[fork] = id;
    const now = nowIso();
    this.mem[id] = {
      id,
      day: cur?.day ?? i.day,
      body,
      mood,
      created_at: cur?.created_at ?? now,
      updated_at: now,
      deleted_at: null,
      locked: false,
    };
    this.touch(id, body);
    return { ok: true, id };
  }

  /** 지우기 — 빈 글로 덮어써서(옛 내용이 안 남게) 지움 표시. 열린 글만 */
  remove(id: string): boolean {
    if (this.stateNow().kind !== "ready") return false;
    const cur = this.mem[id];
    if (!cur || cur.locked || cur.deleted_at) return false;
    const now = nowIso();
    this.mem[id] = { ...cur, body: "", mood: null, deleted_at: now, updated_at: now };
    this.removedHere.set(id, Date.now());
    this.touch(id, "");
    return true;
  }

  private touch(id: string, body: string) {
    this.seq[id] = (this.seq[id] ?? 0) + 1;
    this.mine[id] = body;
    this.emit();
    void this.queue(id, () => this.persist(id));
    this.scheduleUpload();
  }

  /** 메모리 → 잠금 → IndexedDB. 줄 안에서만 돈다 */
  private async persist(id: string): Promise<void> {
    const e = this.mem[id];
    const s = this.seq[id] ?? 0;
    if (!e || e.locked || s === (this.persistedSeq[id] ?? 0)) return;
    // 잠김 상태로 바뀌었어도 지금 열쇠는 그대로 있다 — 글을 지키는 게 먼저
    const kid = this.ring?.current;
    const key = kid ? this.ring?.keys[kid] : undefined;
    if (!kid || !key) throw new Error("일기 열쇠가 없어요");
    try {
      const sealed = await seal({ body: e.body, mood: e.mood }, key, kid, this.uid, id, e.day);
      const row = await this.storage.updateRow(this.uid, id, (cur) => ({
        id,
        day: e.day,
        sealed,
        created_at: e.created_at,
        updated_at: e.updated_at,
        deleted_at: e.deleted_at,
        // 바탕 판은 늘 저장소에서(메모리 아님)
        ver: cur?.ver ?? null,
        synced_at: cur?.synced_at ?? null,
        dirty: !!this.remote,
        err: null,
        tries: 0,
      }));
      if (row) this.stored[id] = row;
      if (s > (this.persistedSeq[id] ?? 0)) this.persistedSeq[id] = s;
      if (this.error?.startsWith("이 기기에")) this.error = null;
    } catch (err) {
      this.error = "이 기기에 일기를 저장하지 못했어요 — 저장 공간을 확인해 주세요";
      this.emit();
      throw err;
    }
    announce(this.chan, { t: "rows", ids: [id] });
    this.emit();
  }

  // ───────────── 올리기 ─────────────
  private scheduleUpload(ms = this.uploadDelay) {
    if (!this.remote || this.disposed) return;
    const at = Date.now() + ms;
    // 이미 더 일찍 잡혀 있으면 그대로(쓰는 동안 미뤄지기만 하지 않게 — 많아야 uploadDelay 마다 한 번)
    if (this.uploadTimer && this.uploadAt <= at) return;
    if (this.uploadTimer) clearTimeout(this.uploadTimer);
    this.uploadAt = at;
    this.uploadTimer = setTimeout(() => {
      this.uploadTimer = null;
      void this.flush();
    }, ms);
  }

  /** 지금 바로 올리기(편집기 벗어날 때·시트 닫을 때·화면 숨을 때) */
  flushSoon() {
    this.scheduleUpload(0);
  }

  onOnline() {
    this.backoff = 2000;
    void this.syncKeys();
    void this.pull();
    void this.flush();
  }

  onVisible() {
    if (Date.now() - this.lastKeyCheck > 20_000) void this.syncKeys();
    if (this.pendingCount() > 0) this.scheduleUpload(0);
  }

  flush(): Promise<void> {
    if (!this.remote || this.disposed) return Promise.resolve();
    if (this.flushP) {
      this.flushAgain = true;
      return this.flushP;
    }
    const run = async () => {
      try {
        await this.loaded;
        // 충돌로 사본·판 옮기기가 생기면 같은 호출 안에서 이어서 올린다(최대 10번).
        // 이번에 실패한 글은 이 호출 안에서 다시 보내지 않는다(실패 횟수가 한꺼번에 늘지 않게)
        const failed = new Set<string>();
        for (let round = 0; round < 10 && !this.disposed; round++) {
          this.flushAgain = false;
          const more = await this.flushOnce(failed);
          if (!more && !this.flushAgain) break;
        }
      } catch (e) {
        console.warn("[diary] 올리기 오류", e);
      } finally {
        this.flushP = null;
      }
    };
    this.flushP = run();
    return this.flushP;
  }

  /** 한 바퀴 올리기. true = 충돌을 풀어서 새로 올릴 게 생김 */
  private async flushOnce(failed: Set<string>): Promise<boolean> {
    const remote = this.remote;
    if (!remote || this.status !== "live" || this.disposed || offline()) return false;
    // 저장 중인 것부터 끝낸다(열쇠는 필요 없다 — 이미 잠겨 있음)
    await Promise.all([...this.chains.values()]);
    const rows = Object.values(this.stored)
      .filter((r) => r.dirty && (r.tries ?? 0) < MAX_TRIES && !failed.has(r.id))
      .sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : 0))
      .slice(0, 50);
    if (rows.length === 0) return false;
    let netFail = false;
    let progress = false;
    let resolved = false;
    let lastErr: string | null = null;
    for (const r of rows) {
      if (this.disposed) return false;
      let res: { ver: number; synced_at: string } | null;
      try {
        // 이 7개 열만 — 평문·기분은 절대 안 감
        res = await remote.pushEntry({
          id: r.id,
          day: r.day,
          sealed: r.sealed,
          created_at: r.created_at,
          updated_at: r.updated_at,
          deleted_at: r.deleted_at,
          base_ver: r.ver,
        });
      } catch (e) {
        if (isNetworkError(e)) {
          netFail = true;
          break;
        }
        // 이 글만 문제 — 표시하고 다음 글로(버리지 않음)
        const msg = errMsg(e);
        lastErr = msg;
        failed.add(r.id);
        await this.queue(r.id, async () => {
          const row = await this.storage.updateRow(this.uid, r.id, (c) =>
            c?.sealed === r.sealed ? { ...c, err: msg, tries: (c.tries ?? 0) + 1 } : null,
          );
          if (row) this.stored[r.id] = row;
          announce(this.chan, { t: "rows", ids: [r.id] });
          this.emit();
        }).catch(() => undefined);
        continue;
      }
      try {
        if (res) {
          const ok = res;
          await this.queue(r.id, () => this.markUploaded(r, ok));
        } else {
          await this.queue(r.id, () => this.resolveConflict(r));
          resolved = true;
        }
        progress = true;
      } catch (e) {
        if (isNetworkError(e)) {
          netFail = true;
          break;
        }
        lastErr = errMsg(e);
        failed.add(r.id);
      }
    }
    const remaining = Object.values(this.stored).some((r) => r.dirty && (r.tries ?? 0) < MAX_TRIES);
    const again = !netFail && remaining && progress && (resolved || rows.length === 50);
    if (netFail || (remaining && !again)) {
      // 인터넷 문제·실패한 글 — 2초부터 늘려 가며 다시(실패한 글은 5번까지)
      this.scheduleUpload(this.backoff);
      this.backoff = Math.min(this.backoff * 2, 60_000);
    } else if (!remaining) {
      this.backoff = 2000;
    }
    if (lastErr) this.error = `일기 올리기 실패: ${lastErr}`;
    else if (!netFail && this.error?.startsWith("일기 올리기")) this.error = null;
    this.emit();
    return again;
  }

  /** 올라감 — 그새 더 고쳤으면 판(ver)만 올려서 다음에 그 위에 올린다 */
  private async markUploaded(r: StoredRow, res: { ver: number; synced_at: string }) {
    const row = await this.storage.updateRow(this.uid, r.id, (c) => {
      if (!c) return null;
      if (c.sealed === r.sealed) return { ...c, dirty: false, ver: res.ver, synced_at: res.synced_at, err: null, tries: 0 };
      return { ...c, ver: res.ver };
    });
    if (row) this.stored[r.id] = row;
    announce(this.chan, { t: "rows", ids: [r.id] });
    this.emit();
  }

  /** 서버가 버림 — 다른 기기가 먼저 고쳤다. 줄 안에서만 돈다 */
  private async resolveConflict(r: StoredRow) {
    const remote = this.remote;
    if (!remote) return;
    const got = await remote.getEntry(r.id);
    if (!got) {
      const row = await this.storage.updateRow(this.uid, r.id, (c) =>
        c?.sealed === r.sealed ? { ...c, err: "missing", tries: (c.tries ?? 0) + 1 } : null,
      );
      if (row) this.stored[r.id] = row;
      this.emit();
      return;
    }
    const s = normEntry(got);
    // 지난번에 올라갔는데 답만 못 받았음
    if (s.sealed === r.sealed && !!s.deleted_at === !!r.deleted_at) return this.markUploaded(r, s);
    const S = await this.derive(s);
    const L = this.mem[r.id];
    if (!L || L.locked) return; // 이 탭은 못 연다 — 열쇠 있는 탭이 맞춘다
    if (L.deleted_at) return this.applyServer(s, S); // 내 지우기는 접는다 — 다른 기기의 글이 남는다
    if (s.deleted_at) {
      // 저쪽이 지움 → 내 글을 그 판 위로 옮겨 다시 올린다(내 글이 살아남음)
      const row = await this.storage.updateRow(this.uid, r.id, (c) => (c ? { ...c, ver: s.ver } : null));
      if (row) this.stored[r.id] = row;
      this.emit();
      return;
    }
    if (!S.locked && S.body === L.body && S.mood === L.mood) return this.applyServer(s, S);
    // 둘 다 남긴다 — 내 글은 새 id 사본으로, 이 id 는 서버 글로
    const copyId = uuid();
    const now = nowIso();
    this.mem[copyId] = { ...L, id: copyId, created_at: now, updated_at: now, deleted_at: null, locked: false };
    this.seq[copyId] = 1;
    this.mine[copyId] = L.body;
    this.emit();
    await this.queue(copyId, () => this.persist(copyId)); // 사본이 저장돼야 다음으로
    this.forkOf[r.id] = copyId;
    const L2 = this.mem[r.id];
    if (L2 && !L2.locked && !L2.deleted_at && (L2.body !== L.body || L2.mood !== L.mood)) {
      // 그사이 더 쓴 것도 사본으로
      this.mem[copyId] = { ...this.mem[copyId], body: L2.body, mood: L2.mood, updated_at: nowIso() };
      this.touch(copyId, L2.body);
    }
    return this.applyServer(s, S);
  }

  /** 서버 글로 덮어씀(메모리는 바로, 저장소는 뒤따라) */
  private async applyServer(s: ServerEntry, S: Mem) {
    this.mem[s.id] = S;
    this.persistedSeq[s.id] = this.seq[s.id] ?? 0;
    if (!s.deleted_at) this.removedHere.delete(s.id);
    const row = await this.storage.updateRow(this.uid, s.id, () => fromServer(s));
    if (row) this.stored[s.id] = row;
    announce(this.chan, { t: "rows", ids: [s.id] });
    this.emit();
  }

  // ───────────── 받기 ─────────────
  pull(): Promise<void> {
    if (!this.remote || this.disposed) return Promise.resolve();
    if (this.pullP) {
      this.pullAgain = true;
      return this.pullP;
    }
    const run = async () => {
      try {
        await this.loaded;
        do {
          this.pullAgain = false;
          await this.pullOnce();
        } while (this.pullAgain && !this.disposed);
      } catch (e) {
        console.warn("[diary] 받기 오류", e);
      } finally {
        this.pullP = null;
      }
    };
    this.pullP = run();
    return this.pullP;
  }

  private async pullOnce() {
    const remote = this.remote;
    if (!remote || this.status !== "live" || this.disposed || offline()) return;
    try {
      const saved = await this.storage.getMeta(this.uid, "cursor");
      const start = [saved, this.cursor].filter((c): c is string => !!c).sort().pop() ?? null;
      let max = start ? Date.parse(start) : 0;
      // 첫 쪽만 2분 겹쳐 받는다 — 늦게 커밋된 것도 놓치지 않게(다시 받아도 ver 로 걸러짐)
      let after: string | null = start ? new Date(max - 2 * 60_000).toISOString() : null;
      for (let page = 0; page < 20; page++) {
        const rows = await remote.pullEntries(after, PAGE);
        for (const r of rows) {
          await this.applyRemote(r);
          const t = Date.parse(r.synced_at);
          if (t > max) max = t;
        }
        if (rows.length < PAGE) break;
        after = rows[rows.length - 1].synced_at;
      }
      if (max) await this.setCursor(max);
      if (this.error?.startsWith("일기 받기")) this.error = null;
    } catch (e) {
      if (!isNetworkError(e)) {
        console.warn("[diary] 받기 실패", e);
        this.error = `일기 받기 실패: ${errMsg(e)}`;
      }
      this.emit();
      return;
    }
    this.emit();
    await this.syncKeys();
  }

  private async setCursor(ms: number) {
    if (this.cursor && Date.parse(this.cursor) >= ms) return;
    this.cursor = new Date(ms).toISOString();
    try {
      await this.storage.putMeta(this.uid, "cursor", this.cursor);
    } catch {
      // 다음에 다시
    }
  }

  /** 서버 글 하나 반영 — 내가 아직 안 올린 글이면 건드리지 않는다(올릴 때 맞춘다) */
  private async applyRemote(raw: Partial<ServerEntry>): Promise<void> {
    if (!raw?.id || this.status !== "live" || !this.remote) return;
    let got: ServerEntry | null = raw as ServerEntry;
    if (typeof raw.sealed !== "string" || !SEALED_RE.test(raw.sealed) || typeof raw.ver !== "number" || !raw.day) {
      // 실시간 알림에 sealed 가 빠졌거나 잘림 → 직접 받아 온다
      try {
        got = await this.remote.getEntry(raw.id);
      } catch {
        return; // 다음 받기에서
      }
      if (!got) return;
    }
    const s = normEntry(got);
    await this.queue(s.id, async () => {
      const cur = this.stored[s.id];
      if (cur?.dirty) return;
      if (cur && cur.ver != null && s.ver <= cur.ver) return; // 순서가 뒤바뀐 것·겹쳐 받은 것
      const seqAt = this.seq[s.id] ?? 0;
      if (seqAt !== (this.persistedSeq[s.id] ?? 0)) return; // 저장 전 편집 — 올릴 때 맞춘다
      const plain = await this.derive(s);
      let applied = false;
      const row = await this.storage.updateRow(this.uid, s.id, (c) => {
        if (c?.dirty || (c && c.ver != null && s.ver <= c.ver) || (this.seq[s.id] ?? 0) !== seqAt) return null;
        applied = true;
        return fromServer(s);
      });
      if (!applied) {
        if (row && row.sealed !== this.stored[s.id]?.sealed) {
          // 다른 탭이 먼저 바꿔 둠
          this.stored[s.id] = row;
          if ((this.seq[s.id] ?? 0) === (this.persistedSeq[s.id] ?? 0)) this.mem[s.id] = await this.derive(row);
          this.emit();
        }
        return;
      }
      if (row) this.stored[s.id] = row;
      this.mem[s.id] = plain;
      this.persistedSeq[s.id] = this.seq[s.id] ?? 0;
      if (!s.deleted_at) this.removedHere.delete(s.id);
      announce(this.chan, { t: "rows", ids: [s.id] });
      this.emit();
    });
  }

  /** PlannerStore 의 Realtime 채널에 붙인다(subscribe 전에) */
  attachRealtime(ch: RealtimeChannel) {
    if (!this.remote || this.mode !== "cloud") return;
    const filter = `user_id=eq.${this.uid}`;
    ch.on("postgres_changes", { event: "*", schema: "public", table: "diary_entries", filter }, (payload) => {
      const row = payload.new as Partial<ServerEntry> | undefined;
      if (!row || !row.id) return;
      // 반영한 뒤에만 커서를 민다
      this.track(
        this.loaded
          .then(() => this.applyRemote(row))
          .then(() => {
            if (typeof row.synced_at === "string" && !Number.isNaN(Date.parse(row.synced_at)))
              return this.setCursor(Date.parse(row.synced_at));
          }),
      );
    });
    ch.on("postgres_changes", { event: "*", schema: "public", table: "diary_keys", filter }, () => {
      this.track(this.syncKeys());
    });
  }

  // ───────────── 이 기기에서 지우기 ─────────────
  /** 로그아웃 때 '이 기기에서 일기도 지우기' — 못 올린 글이 있으면 거절(false) */
  async wipe(): Promise<boolean> {
    await this.loaded;
    if (this.status === "live") {
      await this.flush();
      await Promise.all([...this.chains.values()]);
      if (this.pendingCount() > 0) return false;
    }
    try {
      await this.storage.wipe(this.uid);
    } catch (e) {
      console.warn("[diary] 지우기 실패", e);
      return this.status !== "live";
    }
    announce(this.chan, { t: "wipe" });
    this.resetEmpty();
    return true;
  }
}

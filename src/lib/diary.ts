// 일기 엔진 — 화면은 이것만 본다.
//   쓰기: 메모리(평문) → 기기에서 잠금 → IndexedDB(잠긴 채로) → 서버(잠긴 채로, 5초에 한 번까지)
//   충돌: 서버의 판(ver)을 같이 보낸다. 서버가 버리면(다른 기기가 먼저 고침) 두 글을 다 남긴다 — 내 글은 사본으로.
//   같은 기기의 다른 탭과는 IndexedDB 행의 sealed 로 비교-후-쓰기(CAS) — 한쪽만 바꾼 칸은 합치고, 같은 칸이면 사본.
//   글은 절대 버리지 않는다. 못 올린 글은 표시만 하고 남겨 둔다. 기기 저장이 안 되면 메모리에 두고 서버에 올려 지킨다.
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

/** 이 탭의 화면(mem)이 어떤 저장 행에서 나왔는지 — 다른 탭과 비교-후-쓰기(CAS)·세 갈래 합치기의 바탕 */
interface Basis {
  sealed: string;
  /** 날짜·지움도 같이 — sealed 는 그대로인데 날짜만 옮겨지면(서버 조작) 다시 열어서 잠긴 글로 보여야 한다 */
  day: string;
  deletedAt: string | null;
  body: string;
  mood: number | null;
  deleted: boolean;
  locked: boolean;
}

type RowLike = Pick<StoredRow, "id" | "day" | "sealed" | "created_at" | "updated_at" | "deleted_at">;

const MAX_TRIES = 5;
const REMOVE_GRACE_MS = 5000;
const PAGE = 500;
/** 답을 못 받은 채 기억해 두는 보낸 sealed 수 */
const MAX_SENT = 8;
const WIPED = "일기를 이 기기에서 지웠어요";
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

/** 서버가 받았다고 확인됨 — 답 못 받은 기록은 이제 필요 없다 */
function withoutSent(r: StoredRow): StoredRow {
  const { sent: _sent, ...rest } = r;
  void _sent;
  return rest;
}

/** 충돌 사본 id — 같은 글의 같은 내용(sealed)에서 갈라지면 어느 탭이 풀어도 같은 id(두 탭이 동시에 풀어도 사본은 하나) */
async function copyIdFor(id: string, sealed: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`DREAM-diary-copy-v1|${id}|${sealed}`)));
  h[6] = (h[6] & 0x0f) | 0x80; // UUID version 8(직접 만든 것)
  h[8] = (h[8] & 0x3f) | 0x80; // variant
  const x = Array.from(h.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/**
 * 같은 저장소 — 다만 지우는 중·지운 뒤엔 쓰기를 막는다.
 * 그 전에 시작한 받기·실시간·열쇠 작업이 늦게 끝나도 지운 기기에 잠긴 글·열쇠·커서를 다시 적지 않게.
 */
function guarded(s: DiaryStorage, dead: () => boolean): DiaryStorage {
  const stop = () => {
    if (dead()) throw new Error(WIPED);
  };
  return {
    scope: s.scope,
    getKeyring: (u) => s.getKeyring(u),
    putKeyring: async (u, k) => {
      stop();
      return s.putKeyring(u, k);
    },
    updateKeyring: async (u, fn) => {
      stop();
      return s.updateKeyring(u, (c) => (dead() ? null : fn(c)));
    },
    rows: (u) => s.rows(u),
    getRow: (u, id) => s.getRow(u, id),
    updateRow: async (u, id, fn) => {
      stop();
      return s.updateRow(u, id, (c) => (dead() ? null : fn(c)));
    },
    getMeta: (u, n) => s.getMeta(u, n),
    putMeta: async (u, n, v) => {
      stop();
      return s.putMeta(u, n, v);
    },
    wipe: (u) => s.wipe(u),
  };
}

export class DiaryEngine {
  readonly uid: string;
  readonly mode: DiaryMode;
  private remote: DiaryRemote | null;
  /** 지우기(wipe)만 이것을 직접 쓴다 */
  private raw: DiaryStorage;
  private storage: DiaryStorage;
  private onChange: (s: DiarySnap) => void;
  private uploadDelay: number;
  private chan: string;
  private bc: BroadcastChannel | null = null;
  private started = false;
  private disposed = false;
  /** 이 기기에서 지웠다(또는 지우는 중) — 더는 기기 저장소에 쓰지 않는다 */
  private dead = false;
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
  /** 저장소 행의 거울. localStale 에 든 id 는 저장소보다 앞서 있다(기기 저장 실패 — 메모리에만) */
  private stored: Record<string, StoredRow> = {};
  private basis: Record<string, Basis> = {};
  private seq: Record<string, number> = {};
  private persistedSeq: Record<string, number> = {};
  /** 이 엔진이 마지막으로 쓴 본문 — '편집 중에 다른 곳에서 바뀜'을 가르는 기준 */
  private mine: Record<string, string> = {};
  /** 갈라져 나온 사본 — 같은 편집기의 다음 저장은 그 사본으로 */
  private forkOf: Record<string, string> = {};
  /** 이 기기에서 지운 글(지운 시각) — 편집기가 닫히며 바로 뒤따라온 저장이 되살리지 않게 */
  private removedHere = new Map<string, number>();
  private chains = new Map<string, Promise<void>>();
  private bg = new Set<Promise<unknown>>();
  /** 기기 저장이 실패한 편집(기기 모드 — 지킬 서버가 없어 다시 시도) */
  private persistFailed = new Set<string>();
  /** 메모리 거울에만 있고 기기엔 아직 못 적은 행(서버 모드 — 서버로 지키고, 저장소가 돌아오면 옮겨 적는다) */
  private localStale = new Set<string>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 3000;

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
    this.raw = o.storage ?? idbDiaryStorage();
    this.storage = guarded(this.raw, () => this.dead);
    this.onChange = o.onChange;
    this.uploadDelay = o.uploadDelayMs ?? 5000;
    this.chan = channelName(this.uid, this.raw);
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
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
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
        this.setBasis(r.id, r, derived[i]);
      });
      this.status = "live";
    } finally {
      this.markLoaded();
      this.emit();
    }
    if (this.remote && !this.disposed) {
      // 지난번에 5번 실패해서 멈춘 글도 켤 때마다 다시 올려 본다
      await this.unpark();
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
      const dirty = (!!st?.dirty && !!this.remote) || this.unsaved(id);
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

  /**
   * 이 기기에서 쓸 수 있나 — 지금 열쇠(ring.current)를 쥐고 있으면 된다.
   * 다른 기기에서 열쇠가 바뀌어 '잠김(key_changed)'으로 보여도, 쓰던 글은 지금 열쇠로 계속 잠가 저장한다(글을 지키는 게 먼저).
   * 그 열쇠는 서버 ring 에 들어 있어 다른 기기도 연다.
   */
  private canWrite(): boolean {
    if (this.mode === "off" || this.status !== "live" || this.dead || this.disposed) return false;
    const kid = this.ring?.current;
    return !!(kid && this.ring?.keys[kid]);
  }

  private unsaved(id: string): boolean {
    return (this.seq[id] ?? 0) !== (this.persistedSeq[id] ?? 0);
  }

  private pendingCount(): number {
    let n = 0;
    const ids = new Set([...Object.keys(this.mem), ...Object.keys(this.stored)]);
    for (const id of ids) {
      if ((this.stored[id]?.dirty && this.remote) || this.unsaved(id)) n++;
    }
    return n;
  }

  // ───────────── 줄 세우기(글마다 하나씩) ─────────────
  private queue<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(id) ?? Promise.resolve();
    const run = prev.then(fn);
    const tail: Promise<void> = run
      .then(
        () => undefined,
        (e) => {
          if (!isNetworkError(e) && errMsg(e) !== WIPED) console.warn("[diary]", id, e);
        },
      )
      .then(() => {
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

  private setBasis(id: string, row: RowLike, m: Mem) {
    this.basis[id] = {
      sealed: row.sealed,
      day: row.day,
      deletedAt: row.deleted_at ?? null,
      body: m.body,
      mood: m.mood,
      deleted: !!m.deleted_at,
      locked: m.locked,
    };
  }

  /** 화면(mem)이 이 행에서 나온 그대로인가 */
  private sameBasis(id: string, row: RowLike): boolean {
    const b = this.basis[id];
    return !!b && b.sealed === row.sealed && b.day === row.day && b.deletedAt === (row.deleted_at ?? null);
  }

  /**
   * 저장소에서 읽은(또는 방금 고친) 행을 받아들인다. 줄 안에서만.
   * 이 탭의 화면이 다른 sealed 에서 나왔고 안 저장한 편집이 없으면 그 행으로 다시 연다 —
   * 다른 탭이 쓴 글을 놓친 채 남아 있다가 다음 저장으로 덮어쓰는 일이 없게.
   * 안 저장한 편집이 있으면 화면은 그대로 두고, 줄 서 있는 저장이 비교-후-쓰기로 맞춘다.
   */
  private async adopt(id: string, row: StoredRow | null, plain?: Mem) {
    if (!row) return;
    this.stored[id] = row;
    if (this.mem[id] && this.sameBasis(id, row)) {
      this.emit();
      return;
    }
    if (this.unsaved(id)) {
      this.emit();
      return;
    }
    const m = plain ?? (await this.derive(row));
    if (this.stored[id] !== row || this.unsaved(id)) return; // 그새 또 바뀜 — 그쪽이 맞춘다
    this.mem[id] = m;
    this.setBasis(id, row, m);
    if (!row.deleted_at) this.removedHere.delete(id);
    this.emit();
  }

  // ───────────── 기기 저장소 ─────────────
  /** 행 하나 읽기 — 메모리에만 있는 행(기기 저장 실패)은 메모리 것을 */
  private async read(id: string): Promise<StoredRow | null> {
    if (this.localStale.has(id)) return this.stored[id] ?? null;
    return this.storage.getRow(this.uid, id);
  }

  /**
   * 행 하나 고치기(한 트랜잭션, fn 은 동기·몇 번 불려도 같은 답). local=false 면 기기엔 못 적고 메모리 거울에만 적용함 —
   * 서버 모드에서만(서버에 올려서 지킨다). 기기 모드는 지킬 곳이 없으니 그대로 던진다.
   */
  private async write(
    id: string,
    fn: (cur: StoredRow | null) => StoredRow | null,
  ): Promise<{ row: StoredRow | null; local: boolean }> {
    if (this.dead) throw new Error(WIPED);
    if (this.localStale.has(id)) {
      // 기기가 이 행을 모른다(지난번에 못 적음) — 메모리 것 위에 적용하고, 통째로 옮겨 적어 본다
      const cur = this.stored[id] ?? null;
      const next = fn(cur ? { ...cur } : null);
      const row = next ? { ...next, id } : cur;
      if (row) {
        try {
          await this.storage.updateRow(this.uid, id, () => row);
          this.localStale.delete(id);
          this.storageOk();
          return { row, local: true };
        } catch (e) {
          if (this.dead) throw e;
          this.storageFailed(e);
        }
      }
      return { row, local: false };
    }
    try {
      const row = await this.storage.updateRow(this.uid, id, fn);
      this.storageOk();
      return { row, local: true };
    } catch (e) {
      if (this.dead || !this.remote) throw e;
      this.storageFailed(e);
      const cur = this.stored[id] ?? null;
      const next = fn(cur ? { ...cur } : null);
      if (!next) return { row: cur, local: false };
      this.localStale.add(id);
      return { row: { ...next, id }, local: false };
    }
  }

  private storageFailed(e: unknown) {
    console.warn("[diary] 기기 저장 실패", e);
    const full = (e as { name?: string } | null)?.name === "QuotaExceededError";
    this.error = full
      ? "이 기기 저장 공간이 꽉 찼어요 — 일기를 기기에 저장하지 못했어요"
      : "이 기기 저장소에 일기를 쓰지 못했어요 — 다시 시도하는 중이에요";
    if (this.remote) this.error += " (인터넷이 되면 서버엔 올라가요)";
    this.scheduleRetry();
    this.emit();
  }

  private storageOk() {
    if (this.error?.startsWith("이 기기") && !this.persistFailed.size && !this.localStale.size) {
      this.error = null;
      this.emit();
    }
  }

  /** 못 한 기기 저장 다시 — 저장 실패한 편집과 메모리에만 있는 행. 저장소 연결이 돌아왔으면 여기서 맞춰진다 */
  private retryLocal(): Promise<unknown> {
    if (this.dead || (!this.persistFailed.size && !this.localStale.size)) return Promise.resolve();
    const jobs: Promise<unknown>[] = [];
    for (const id of this.persistFailed) jobs.push(this.queue(id, () => this.persist(id)).catch(() => undefined));
    for (const id of this.localStale) jobs.push(this.queue(id, () => this.heal(id)).catch(() => undefined));
    return Promise.all(jobs);
  }

  private scheduleRetry() {
    if (this.retryTimer || this.disposed || this.dead) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.retryLocal().then(() => {
        if (this.persistFailed.size || this.localStale.size) {
          this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
          this.scheduleRetry();
        } else {
          this.retryDelay = 3000;
        }
      });
    }, this.retryDelay);
  }

  /** 메모리에만 있던 행을 기기에 옮겨 적기 */
  private async heal(id: string) {
    if (!this.localStale.has(id)) return;
    const row = this.stored[id];
    if (!row) {
      this.localStale.delete(id);
      return;
    }
    await this.storage.updateRow(this.uid, id, () => row);
    this.localStale.delete(id);
    this.storageOk();
    // 기기에 다 옮겨 적었으면 받기 커서도 이제 적는다(그 전엔 새로고침 뒤 그 글들을 다시 받도록 미뤄 둠)
    if (!this.localStale.size && this.cursor) await this.storage.putMeta(this.uid, "cursor", this.cursor).catch(() => undefined);
    announce(this.chan, { t: "rows", ids: [id] });
  }

  // ───────────── 다른 탭 ─────────────
  private onMessage(m: DiaryMsg) {
    if (this.disposed || !m || typeof m !== "object") return;
    void this.loaded.then(() => {
      if (this.disposed || this.dead || this.status !== "live") return;
      if (m.t === "keys") {
        void this.reloadRing().then((changed) => {
          if (!changed || !this.remote) return;
          // 다른 탭(로그인 등)이 열쇠를 바꿈 — 서버 열쇠 행도 그새 바뀌었을 수 있으니 다시 본다
          this.row = undefined;
          this.emit();
          return this.syncKeys();
        });
      } else if (m.t === "rows") {
        // 이 탭이 그 글로 할 일이 있어도 버리지 않고 뒤에 줄 세운다 — 놓치면 화면이 옛 글에 머물다 덮어쓴다
        for (const id of Array.isArray(m.ids) ? m.ids : []) void this.queue(id, () => this.reloadRow(id)).catch(() => undefined);
      } else if (m.t === "wipe") {
        // 다른 탭이 이 기기 일기를 지움 — 이 탭도 더는 쓰지 않는다(늦게 끝난 받기가 되살리지 않게)
        this.dead = true;
        this.resetEmpty();
      }
    });
  }

  private async reloadRow(id: string) {
    if (this.localStale.has(id)) return;
    await this.adopt(id, await this.storage.getRow(this.uid, id));
  }

  private resetEmpty() {
    this.mem = {};
    this.stored = {};
    this.basis = {};
    this.seq = {};
    this.persistedSeq = {};
    this.mine = {};
    this.forkOf = {};
    this.removedHere.clear();
    this.persistFailed.clear();
    this.localStale.clear();
    this.ring = null;
    this.cursor = null;
    this.oldPw = false;
    this.retry = null;
    if (this.uploadTimer) clearTimeout(this.uploadTimer);
    this.uploadTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.emit();
  }

  /** 저장된 열쇠 꾸러미 다시 읽기. 바뀌었으면 true */
  private async reloadRing(): Promise<boolean> {
    if (this.status !== "live" || this.disposed || this.dead) return false;
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
        const row = await this.read(id);
        if (!row) return;
        const plain = await this.derive(row);
        if (plain.locked || !this.mem[id]?.locked) return;
        if (this.stored[id] && this.stored[id].sealed !== row.sealed) return;
        this.stored[id] = row;
        this.mem[id] = plain;
        this.setBasis(id, row, plain);
        this.emit();
      });
      jobs.push(job.catch(() => undefined));
    }
    await Promise.all(jobs);
  }

  // ───────────── 열쇠 ─────────────
  /** 서버 열쇠 점검 + 꾸러미 다시 읽기 */
  private async syncKeys(): Promise<void> {
    if (!this.remote || this.disposed || this.dead) return;
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
    if (!this.remote || this.disposed || this.dead) return "network";
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
    if (!this.remote || this.disposed || this.dead) return "network";
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
    if (this.status !== "live" || this.dead) {
      // 이 기기에선 일기 열쇠를 다룰 수 없다(저장소 문제 등) — 비밀번호만 바꾸고,
      // 열쇠가 있는 기기가 새 비밀번호로 다시 감싸도록 서버에 표시해 둔다(로컬 저장소 없이도 됨)
      const res = await plain();
      if (!res.error) await this.flagRewrap();
      return res;
    }
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

  private async flagRewrap() {
    const remote = this.remote;
    if (!remote) return;
    try {
      if (await remote.getKeyRow()) await remote.setNeedsRewrap();
    } catch (e) {
      console.warn("[diary] needs_rewrap 표시 실패", e);
    }
  }

  /** 시트를 열 때(준비 안 됐으면) — 열쇠·글 다시 맞추기 */
  async refresh(): Promise<void> {
    await this.loaded;
    if (this.status !== "live" || this.dead) return;
    await this.reloadRing();
    if (this.remote) await this.pull();
  }

  // ───────────── 쓰기 ─────────────
  /**
   * 글 저장(메모리 즉시, 기기·서버는 뒤에서).
   *  id 없음 → 새 글. 없는 id → 그 id 로 새 글(편집기가 미리 만든 id).
   *  base: 편집을 시작할 때(또는 마지막 저장 때) 본 본문 — 그새 다른 곳에서 바뀌었으면 사본으로 갈라 둘 다 남긴다.
   *  돌려준 id 가 넘긴 id 와 다르면 사본(또는 새 글)에 썼다는 뜻.
   *  지금 열쇠를 쥐고 있으면 '다른 기기에서 열쇠가 바뀜' 상태여도 저장한다(쓰던 글을 잃지 않게).
   */
  save(i: SaveInput): SaveResult {
    if (!this.canWrite()) return { ok: false, error: "locked" };
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
    if (!this.canWrite()) return false;
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
    void this.queue(id, () => this.persist(id)).catch(() => undefined);
    // 전에 못 한 기기 저장도 같이 다시(연결이 돌아왔으면 여기서 맞춰진다)
    void this.retryLocal();
    this.scheduleUpload();
  }

  /**
   * 메모리 → 잠금 → IndexedDB. 줄 안에서만 돈다.
   * 비교-후-쓰기: 저장소 행이 이 편집의 바탕(basis)과 다르면 다른 탭이 그새 쓴 것 — 덮어쓰지 않고 합치거나 사본으로.
   */
  private async persist(id: string): Promise<void> {
    for (let round = 0; round < 4; round++) {
      const e = this.mem[id];
      const s = this.seq[id] ?? 0;
      if (!e || e.locked || s === (this.persistedSeq[id] ?? 0)) return;
      // 잠김 상태로 바뀌었어도 지금 열쇠는 그대로 있다 — 글을 지키는 게 먼저
      const kid = this.ring?.current;
      const key = kid ? this.ring?.keys[kid] : undefined;
      if (!kid || !key) throw new Error("일기 열쇠가 없어요");
      const sealed = await seal({ body: e.body, mood: e.mood }, key, kid, this.uid, id, e.day);
      const expect = this.basis[id]?.sealed ?? null;
      const box: { other: StoredRow | null } = { other: null };
      let res: { row: StoredRow | null; local: boolean };
      try {
        res = await this.write(id, (cur) => {
          box.other = null;
          if (cur && cur.sealed !== expect) {
            box.other = cur;
            return null;
          }
          const next: StoredRow = {
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
          };
          // 보냈는데 답을 못 받은 기록은 이어 간다(이 편집은 그 위에서 쓴 것)
          if (cur?.sent?.length) next.sent = cur.sent;
          return next;
        });
      } catch (err) {
        if (this.dead) throw err;
        // 기기 모드 — 지킬 곳이 없다. 안 저장된 채(화면에 '저장 안 됨')로 두고 다시 시도
        this.persistFailed.add(id);
        this.storageFailed(err);
        throw err;
      }
      if (box.other) {
        await this.reconcile(id, box.other);
        continue;
      }
      const row = res.row;
      if (row) {
        this.stored[id] = row;
        this.setBasis(id, row, e);
      }
      if (s > (this.persistedSeq[id] ?? 0)) this.persistedSeq[id] = s;
      this.persistFailed.delete(id);
      this.storageOk();
      if (res.local) announce(this.chan, { t: "rows", ids: [id] });
      this.emit();
      return;
    }
    throw new Error("일기 저장이 계속 엇갈려요");
  }

  /**
   * 다른 탭이 그새 이 글을 바꿨다(cur). 한쪽만 바꾼 칸은 그쪽 것으로 합치고(세 갈래 합치기),
   * 같은 칸을 둘 다 바꿨으면 내 편집을 사본으로 갈라 둘 다 남긴다. 지우기는 고친 쪽에 진다.
   * 합쳤으면 화면을 합친 글로 두고 돌아간다 — persist 의 다음 바퀴가 그 행 위에 저장한다.
   */
  private async reconcile(id: string, cur: StoredRow) {
    const theirs = await this.derive(cur);
    const base = this.basis[id];
    const L = this.mem[id];
    const takeTheirs = () => {
      this.stored[id] = cur;
      this.mem[id] = theirs;
      this.setBasis(id, cur, theirs);
      this.persistedSeq[id] = this.seq[id] ?? 0;
      if (!cur.deleted_at) this.removedHere.delete(id);
      this.emit();
    };
    if (!L || L.locked || L.deleted_at) return takeTheirs(); // 내 지우기는 접는다 — 다른 탭의 글이 남는다
    if (!theirs.locked && !theirs.deleted_at && theirs.body === L.body && theirs.mood === L.mood) return takeTheirs();
    if (base && !base.locked && !base.deleted && !theirs.locked && !theirs.deleted_at) {
      const pick = <T>(b: T, l: T, t: T): { v: T } | null =>
        l === t ? { v: l } : l === b ? { v: t } : t === b ? { v: l } : null;
      const body = pick(base.body, L.body, theirs.body);
      const mood = pick(base.mood, L.mood, theirs.mood);
      if (body && mood) {
        this.stored[id] = cur;
        this.setBasis(id, cur, theirs);
        this.mem[id] = { ...L, body: body.v, mood: mood.v, updated_at: nowIso() };
        this.emit();
        return;
      }
    }
    // 같은 칸을 둘 다 바꿈(또는 저쪽이 지움·못 엶) — 내 편집은 새 글로, 이 글은 저쪽 것으로
    await this.forkLocal(id, L, uuid());
    takeTheirs();
  }

  /** 내 편집 L 을 사본(copyId)으로 남긴다 — 그 사본이 기기(또는 메모리 거울)에 저장될 때까지 기다린다 */
  private async forkLocal(id: string, L: Mem, copyId: string) {
    this.forkOf[id] = copyId;
    if (this.mem[copyId]) return; // 다른 탭이 같은 사본을 이미 만듦
    const now = nowIso();
    this.mem[copyId] = { ...L, id: copyId, created_at: now, updated_at: now, deleted_at: null, locked: false };
    this.seq[copyId] = (this.seq[copyId] ?? 0) + 1;
    this.mine[copyId] = L.body;
    this.emit();
    await this.queue(copyId, () => this.persist(copyId));
    this.scheduleUpload();
  }

  // ───────────── 올리기 ─────────────
  private scheduleUpload(ms = this.uploadDelay) {
    if (!this.remote || this.disposed || this.dead) return;
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
    void this.retryLocal();
    this.scheduleUpload(0);
  }

  onOnline() {
    this.backoff = 2000;
    void this.retryLocal();
    void this.syncKeys();
    void this.pull();
    // 서버 장애로 5번 실패해 멈춘 글도 다시
    void this.unpark().then(() => this.flush());
  }

  onVisible() {
    void this.retryLocal();
    if (Date.now() - this.lastKeyCheck > 20_000) void this.syncKeys();
    if (this.pendingCount() > 0) this.scheduleUpload(0);
  }

  /** 못 올린 글 다시 올리기(화면의 '다시 시도') — 5번 실패해서 멈춘 글도 */
  async retryFailed(): Promise<void> {
    await this.loaded;
    if (this.status !== "live" || this.dead) return;
    await this.retryLocal();
    await this.unpark();
    await this.flush();
  }

  /** 5번 실패해서 멈춘 글의 횟수를 되돌린다(켤 때·다시 연결될 때·지우기 전·retryFailed) */
  private async unpark(): Promise<void> {
    if (!this.remote || this.dead) return;
    await this.loaded;
    const ids = Object.values(this.stored)
      .filter((r) => r.dirty && (r.tries ?? 0) >= MAX_TRIES)
      .map((r) => r.id);
    await Promise.all(
      ids.map((id) =>
        this.queue(id, async () => {
          const { row } = await this.write(id, (c) => (c?.dirty && (c.tries ?? 0) >= MAX_TRIES ? { ...c, tries: 0 } : null));
          await this.adopt(id, row);
        }).catch(() => undefined),
      ),
    );
  }

  flush(): Promise<void> {
    if (!this.remote || this.disposed || this.dead) return Promise.resolve();
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
        for (let round = 0; round < 10 && !this.disposed && !this.dead; round++) {
          this.flushAgain = false;
          const more = await this.flushOnce(failed);
          if (!more && !this.flushAgain) break;
        }
      } catch (e) {
        if (errMsg(e) !== WIPED) console.warn("[diary] 올리기 오류", e);
      } finally {
        this.flushP = null;
      }
    };
    this.flushP = run();
    return this.flushP;
  }

  /** 올리기 직전 — 보낼 sealed 를 적어 둔다(답이 끊겨도 나중에 내 것인지 알아보게). 보낼 행(그새 바뀌었으면 그 행) */
  private async markSending(id: string): Promise<StoredRow | null> {
    const { row } = await this.write(id, (c) => {
      if (!c?.dirty) return null;
      const sent = c.sent ?? [];
      return sent.includes(c.sealed) ? null : { ...c, sent: [...sent, c.sealed].slice(-MAX_SENT) };
    });
    await this.adopt(id, row);
    return row?.dirty ? row : null;
  }

  /** 한 바퀴 올리기. true = 충돌을 풀어서 새로 올릴 게 생김 */
  private async flushOnce(failed: Set<string>): Promise<boolean> {
    const remote = this.remote;
    if (!remote || this.status !== "live" || this.disposed || this.dead || offline()) return false;
    // 못 한 기기 저장부터(돌아왔으면 기기에, 아니면 메모리 거울에 — 어느 쪽이든 아래에서 올라간다), 저장 중인 것도 끝낸다
    await this.retryLocal();
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
    for (const r0 of rows) {
      if (this.disposed || this.dead) return false;
      const r = await this.queue(r0.id, () => this.markSending(r0.id));
      if (!r) {
        progress = true; // 그새 다른 탭이 올림
        continue;
      }
      if ((r.tries ?? 0) >= MAX_TRIES) continue;
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
        // 인터넷 문제·서버 일시 장애(5xx·429·토큰 만료) — 멈추고 나중에. 실패 횟수엔 안 센다
        if (isNetworkError(e)) {
          netFail = true;
          break;
        }
        // 이 글만 문제(제약 위반 등) — 표시하고 다음 글로(버리지 않음)
        const msg = errMsg(e);
        lastErr = msg;
        failed.add(r.id);
        await this.queue(r.id, async () => {
          const { row, local } = await this.write(r.id, (c) =>
            c?.sealed === r.sealed ? { ...c, err: msg, tries: (c.tries ?? 0) + 1 } : null,
          );
          await this.adopt(r.id, row);
          if (local) announce(this.chan, { t: "rows", ids: [r.id] });
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
    const { row, local } = await this.write(r.id, (c) => {
      if (!c) return null;
      if (c.sealed === r.sealed)
        return { ...withoutSent(c), dirty: false, ver: res.ver, synced_at: res.synced_at, err: null, tries: 0 };
      // 그새 이 내용 위에서 더 고침(이 탭이든 다른 탭이든) → 다음 올리기는 방금 올린 판 위로
      if (c.dirty && c.ver === r.ver) return { ...withoutSent(c), ver: res.ver };
      return null;
    });
    await this.adopt(r.id, row);
    if (local) announce(this.chan, { t: "rows", ids: [r.id] });
    this.emit();
  }

  /** 서버가 버림 — 다른 기기가 먼저 고쳤거나, 지난번에 보낸 내 것이 이미 올라가 있다. 줄 안에서만 돈다 */
  private async resolveConflict(r: StoredRow) {
    const remote = this.remote;
    if (!remote) return;
    // 다른 탭이 그새 풀었거나(같은 행을 같이 올림) 더 썼는지 — 저장소에서 다시 본다
    const cur = await this.read(r.id);
    if (!cur || !cur.dirty || cur.sealed !== r.sealed || cur.ver !== r.ver) {
      await this.adopt(r.id, cur); // 더 쓴 것이면 다음 바퀴에 그걸로 다시 올린다
      return;
    }
    await this.adopt(r.id, cur);
    const got = await remote.getEntry(r.id);
    if (!got) {
      const { row } = await this.write(r.id, (c) =>
        c?.sealed === r.sealed ? { ...c, err: "missing", tries: (c.tries ?? 0) + 1 } : null,
      );
      await this.adopt(r.id, row);
      return;
    }
    const s = normEntry(got);
    // 지난번에 올라갔는데 답만 못 받았음
    if (s.sealed === r.sealed && !!s.deleted_at === !!r.deleted_at) return this.markUploaded(r, s);
    // 그 전에 보낸 내 것이 올라가 있음(답을 못 받은 뒤 더 쓰거나 지움) — 남의 글과의 충돌이 아니다.
    // 서버의 그 판 위로 옮겨서 지금 것을 다시 올린다(사본을 만들지도, 지운 걸 되살리지도 않게)
    if ((cur.sent ?? []).includes(s.sealed)) {
      const { row } = await this.write(r.id, (c) =>
        c?.dirty && c.ver === r.ver ? { ...withoutSent(c), ver: s.ver, synced_at: s.synced_at, err: null } : null,
      );
      await this.adopt(r.id, row);
      return;
    }
    const S = await this.derive(s);
    const L = this.mem[r.id];
    if (!L || L.locked) return; // 이 탭은 못 연다 — 열쇠 있는 탭이 맞춘다
    if (L.deleted_at) return this.applyServer(s, S, r.sealed); // 내 지우기는 접는다 — 다른 기기의 글이 남는다
    if (s.deleted_at) {
      // 저쪽이 지움 → 내 글을 그 판 위로 옮겨 다시 올린다(내 글이 살아남음)
      const { row } = await this.write(r.id, (c) =>
        c?.dirty && c.ver === r.ver ? { ...withoutSent(c), ver: s.ver } : null,
      );
      await this.adopt(r.id, row);
      return;
    }
    if (!S.locked && S.body === L.body && S.mood === L.mood) return this.applyServer(s, S, r.sealed);
    // 둘 다 남긴다 — 내 글은 사본으로(같은 기기의 탭들이 같이 풀어도 같은 id), 이 id 는 서버 글로
    const copyId = await copyIdFor(r.id, r.sealed);
    await this.forkLocal(r.id, L, copyId); // 사본이 저장돼야 다음으로
    const L2 = this.mem[r.id];
    const C = this.mem[copyId];
    if (C && L2 && !L2.locked && !L2.deleted_at && (L2.body !== L.body || L2.mood !== L.mood)) {
      // 그사이 더 쓴 것도 사본으로
      this.mem[copyId] = { ...C, body: L2.body, mood: L2.mood, updated_at: nowIso() };
      this.touch(copyId, L2.body);
    }
    return this.applyServer(s, S, r.sealed);
  }

  /** 서버 글로 덮어씀 — 저장소 행이 내가 풀던 그 행(expect)이거나 더 옛 서버 행일 때만(다른 탭이 그새 더 썼으면 그쪽을 둔다) */
  private async applyServer(s: ServerEntry, S: Mem, expect: string) {
    const box = { ok: false };
    const { row, local } = await this.write(s.id, (c) => {
      box.ok = !c || c.sealed === expect || c.sealed === s.sealed || (!c.dirty && (c.ver ?? -1) <= s.ver);
      return box.ok ? fromServer(s) : null;
    });
    if (!box.ok || !row) {
      await this.adopt(s.id, row);
      return;
    }
    this.stored[s.id] = row;
    this.mem[s.id] = S;
    this.setBasis(s.id, row, S);
    this.persistedSeq[s.id] = this.seq[s.id] ?? 0;
    if (!s.deleted_at) this.removedHere.delete(s.id);
    if (local) announce(this.chan, { t: "rows", ids: [s.id] });
    this.emit();
  }

  // ───────────── 받기 ─────────────
  pull(): Promise<void> {
    if (!this.remote || this.disposed || this.dead) return Promise.resolve();
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
        } while (this.pullAgain && !this.disposed && !this.dead);
      } catch (e) {
        console.warn("[diary] 받기 오류", e);
      } finally {
        this.pullP = null;
      }
    };
    this.pullP = run();
    return this.pullP;
  }

  /**
   * 받기 — 커서(마지막으로 끝까지 받은 synced_at)에서 2분 겹쳐 시작해 (synced_at, id) 순으로 쪽마다.
   * 커서는 받기가 그 쪽까지 다 반영했을 때만 민다(실시간 알림은 커서를 건드리지 않는다).
   */
  private async pullOnce() {
    const remote = this.remote;
    if (!remote || this.status !== "live" || this.disposed || this.dead || offline()) return;
    try {
      const saved = await this.storage.getMeta(this.uid, "cursor").catch(() => null);
      const start = [saved, this.cursor].filter((c): c is string => !!c).sort().pop() ?? null;
      let max = start ? Date.parse(start) : 0;
      // 첫 쪽만 2분 겹쳐 받는다 — 늦게 커밋된 것도 놓치지 않게(다시 받아도 ver 로 걸러짐)
      let after: string | null = start ? new Date(max - 2 * 60_000).toISOString() : null;
      let afterId: string | null = null;
      for (let page = 0; page < 20; page++) {
        const rows = await remote.pullEntries(after, PAGE, afterId);
        for (const r of rows) {
          await this.applyRemote(r); // 못 반영하면 던진다 → 커서는 그대로
          const t = Date.parse(r.synced_at);
          if (t > max) max = t;
        }
        if (max) await this.setCursor(max);
        if (rows.length < PAGE) break;
        // 다음 쪽은 (synced_at, id) 로 이어서 — 같은 시각의 글이 쪽 경계에 걸려도 빠지지 않게
        const last = rows[rows.length - 1];
        after = String(last.synced_at);
        afterId = String(last.id);
      }
      if (this.error?.startsWith("일기 받기")) this.error = null;
    } catch (e) {
      if (!isNetworkError(e) && errMsg(e) !== WIPED) {
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
    if (this.dead || (this.cursor && Date.parse(this.cursor) >= ms)) return;
    this.cursor = new Date(ms).toISOString();
    // 기기에 못 적은 글이 남아 있으면 기기의 커서는 그대로 — 새로고침 뒤 그 글들을 다시 받게
    if (this.localStale.size) return;
    try {
      await this.storage.putMeta(this.uid, "cursor", this.cursor);
    } catch {
      // 다음에 다시
    }
  }

  /** 서버 글 하나 반영 — 내가 아직 안 올린 글이면 건드리지 않는다(올릴 때 맞춘다). 못 반영하면 던진다 */
  private async applyRemote(raw: Partial<ServerEntry>): Promise<void> {
    if (!raw?.id || this.status !== "live" || !this.remote || this.dead) return;
    let got: ServerEntry | null = raw as ServerEntry;
    if (typeof raw.sealed !== "string" || !SEALED_RE.test(raw.sealed) || typeof raw.ver !== "number" || !raw.day) {
      // 실시간 알림에 sealed 가 빠졌거나 잘림 → 직접 받아 온다(실패하면 던진다 — 받기가 커서를 밀지 않게)
      got = await this.remote.getEntry(raw.id);
      if (!got) return;
    }
    const s = normEntry(got);
    await this.queue(s.id, async () => {
      if (this.dead) return;
      const cur = this.stored[s.id];
      if (cur?.dirty) return;
      if (cur && cur.ver != null && s.ver <= cur.ver) return; // 순서가 뒤바뀐 것·겹쳐 받은 것
      if (this.unsaved(s.id)) return; // 저장 전 편집 — 올릴 때 맞춘다
      const plain = await this.derive(s);
      const box = { applied: false };
      const { row, local } = await this.write(s.id, (c) => {
        box.applied = !(c?.dirty || (c && c.ver != null && s.ver <= c.ver));
        return box.applied ? fromServer(s) : null;
      });
      // 반영 못 함 = 다른 탭이 먼저 바꿔 둠 → 그 행으로 맞춘다
      await this.adopt(s.id, row, box.applied ? plain : undefined);
      if (box.applied && local) announce(this.chan, { t: "rows", ids: [s.id] });
    });
  }

  /** PlannerStore 의 Realtime 채널에 붙인다(subscribe 전에) */
  attachRealtime(ch: RealtimeChannel) {
    if (!this.remote || this.mode !== "cloud") return;
    const filter = `user_id=eq.${this.uid}`;
    ch.on("postgres_changes", { event: "*", schema: "public", table: "diary_entries", filter }, (payload) => {
      const row = payload.new as Partial<ServerEntry> | undefined;
      if (!row || !row.id) return;
      // 반영만 한다 — 받기 커서는 받기(pull)가 끝까지 받았을 때만 민다.
      // 여기서 밀면 실패한 받기 구간(다른 기기 글)을 다음 받기가 건너뛴다
      this.track(this.loaded.then(() => this.applyRemote(row)));
    });
    ch.on("postgres_changes", { event: "*", schema: "public", table: "diary_keys", filter }, () => {
      this.track(this.syncKeys());
    });
  }

  // ───────────── 이 기기에서 지우기 ─────────────
  /**
   * 로그아웃 때 '이 기기에서 일기도 지우기'. 못 올린 글이 있으면 거절(false) — force 면 그래도 지운다(화면이 확인을 받은 뒤에만).
   * 지운 뒤 이 엔진은 기기 저장소에 다시 쓰지 않는다(돌고 있던 받기·실시간이 되살리지 않게). 지우지 못했으면 false.
   */
  async wipe(o?: { force?: boolean }): Promise<boolean> {
    if (this.mode === "off") return true; // 로그인 전 — 이 사람의 일기는 이 기기에 없다
    await this.loaded;
    if (this.dead) return true; // 다른 탭이 방금 지움
    if (this.status === "live") {
      // 멈춘 글도 한 번 더 올려 보고
      await this.retryLocal();
      await this.unpark();
      await this.flush();
      await Promise.all([...this.chains.values()]);
      if (!o?.force && this.pendingCount() > 0) return false;
    }
    // 여기부터 이 엔진(그리고 같은 저장소를 쓰는 늦은 작업)은 기기 저장소에 쓰지 못한다
    this.dead = true;
    try {
      await this.raw.wipe(this.uid);
    } catch (e) {
      console.warn("[diary] 지우기 실패", e);
      // 애초에 아무것도 저장할 수 없던 브라우저(Web Crypto 없음)만 '지울 것 없음'으로 친다.
      // 그 밖엔 열쇠·잠긴 글이 남아 있을 수 있다 — 지웠다고 하지 않는다
      if (!supported()) {
        this.resetEmpty();
        return true;
      }
      this.dead = false;
      this.error = "이 기기에서 일기를 지우지 못했어요 — 브라우저를 다시 연 뒤 해 주세요";
      this.emit();
      return false;
    }
    announce(this.chan, { t: "wipe" });
    this.resetEmpty();
    return true;
  }
}

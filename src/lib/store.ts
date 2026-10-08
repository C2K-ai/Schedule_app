"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SETTINGS } from "./settings";
import { DAY, nowIso } from "./time";
import { DEFAULT_CATEGORIES, dayNoteId, defaultCategoryId, localDefaultSlot } from "./ids";
import type { DB, Profile, Row, SyncStatus, TableName } from "./types";
import { DiaryEngine, emptyDiarySnap, type DiaryMode, type DiarySnap } from "./diary";
import { idbDiaryStorage, type DiaryStorage } from "./diaryStorage";
import { supabaseDiaryRemote } from "./diaryRemote";

/**
 * 로컬 우선(local-first) 저장소.
 *
 *  쓰기:  메모리 → localStorage(즉시) → outbox → (온라인이면) Supabase upsert
 *  읽기:  항상 메모리. 화면은 네트워크를 기다리지 않는다.
 *  받기:  Realtime(즉시) + synced_at 커서 기반 델타 pull(놓친 변경 보충)
 *  충돌:  updated_at 이 더 최신인 쪽이 이긴다(LWW). 서버도 같은 규칙의 트리거로 오래된 쓰기를 버린다.
 *
 * 그래서 비행기 안(오프라인)에서도 그대로 쓰고, 착륙 후 연결되면 밀린 변경이 올라간다.
 *
 * 일기는 따로 논다(DiaryEngine) — 기기에서 잠근 채로 IndexedDB·서버에 두고, TABLES·DB·백업 파일엔 넣지 않는다.
 */

export const TABLES: TableName[] = [
  "tasks",
  "habits",
  "task_logs",
  "focus_sessions",
  "categories",
  "day_notes",
  "subjects",
  "study_sessions",
  "career_entries",
  "activities",
];
type AnyTable = TableName | "profiles";

interface OutboxItem {
  table: AnyTable;
  id: string;
  mode: "upsert" | "insertIgnore";
  row: Record<string, unknown>;
  tries: number;
}

export interface Snapshot {
  db: DB;
  status: SyncStatus;
  scope: string;
  userId: string | null;
  /** 일기(평문은 메모리에만) — db 와 따로 */
  diary: DiarySnap;
}

const PREFIX = "must:v1";
const k = (scope: string, part: string) => `${PREFIX}:${scope}:${part}`;

const emptyDb = (): DB => ({
  tasks: {},
  habits: {},
  task_logs: {},
  focus_sessions: {},
  categories: {},
  day_notes: {},
  subjects: {},
  study_sessions: {},
  career_entries: {},
  activities: {},
  profile: null,
});

/** 예전 버전에서 저장된 일정에는 새 필드가 없다 → 기본값으로 채움 */
function normalizeTasks(tasks: DB["tasks"]): DB["tasks"] {
  const out: DB["tasks"] = {};
  for (const [id, t] of Object.entries(tasks ?? {})) {
    out[id] = { ...t, schedule: t.schedule ?? "timed", starred: t.starred ?? false, category_id: t.category_id ?? null };
  }
  return out;
}


function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn("[must] localStorage 저장 실패", e);
    return false;
  }
}

/** 계정으로 옮길 만한 로컬 데이터가 있나 — 자동으로 생기는 기본 카테고리는 빼고 센다 */
export function hasLocalData(scope: string): boolean {
  const db = readJson<DB>(k(scope, "db"), emptyDb());
  return TABLES.some((t) => t !== "categories" && Object.keys(db[t] ?? {}).length > 0);
}

export function readLocalDb(scope: string): DB {
  const db = { ...emptyDb(), ...readJson<DB>(k(scope, "db"), emptyDb()) };
  return { ...db, tasks: normalizeTasks(db.tasks) };
}

export class PlannerStore {
  private snap: Snapshot;
  private listeners = new Set<() => void>();
  private outbox: OutboxItem[] = [];
  private cursor: Partial<Record<AnyTable, string>> = {};
  private channel: RealtimeChannel | null = null;
  private flushTimer: number | null = null;
  private pullTimer: number | null = null;
  private flushing = false;
  private pulling = false;
  private lastPull = 0;
  private backoff = 2000;
  private cleanups: (() => void)[] = [];
  /** 일기 — 로그인(cloud)·서버 없는 빌드(device)·로그아웃(off) */
  readonly diary: DiaryEngine;

  constructor(
    readonly scope: string,
    readonly userId: string | null,
    private remote: SupabaseClient | null,
    diaryMode: DiaryMode = "off",
    diaryStorage?: DiaryStorage,
  ) {
    this.diary = new DiaryEngine({
      uid: userId ?? "local",
      mode: diaryMode,
      remote: remote && userId ? supabaseDiaryRemote(remote, userId) : null,
      storage: diaryStorage ?? idbDiaryStorage(),
      onChange: (d) => this.emit({ diary: d }),
    });
    this.snap = {
      db: emptyDb(),
      scope,
      userId,
      diary: emptyDiarySnap(diaryMode),
      status: {
        mode: remote ? "cloud" : "local",
        online: typeof navigator === "undefined" ? true : navigator.onLine,
        pending: 0,
        lastSyncAt: null,
        realtime: "off",
        error: null,
      },
    };
  }

  // ───────────── 구독(useSyncExternalStore) ─────────────
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;

  private emit(patch: Partial<Snapshot> = {}, status: Partial<SyncStatus> = {}) {
    this.snap = { ...this.snap, ...patch, status: { ...this.snap.status, ...status } };
    this.listeners.forEach((l) => l());
  }

  get db() {
    return this.snap.db;
  }

  // ───────────── 수명 ─────────────
  start() {
    this.diary.start();
    this.load();
    this.ensureProfile();
    this.ensureDefaultCategories();

    const onStorage = (e: StorageEvent) => {
      // 다른 탭에서 바꾼 내용 즉시 반영
      if (e.key === k(this.scope, "db")) this.emit({ db: readLocalDb(this.scope) });
      if (e.key === k(this.scope, "outbox")) {
        this.outbox = readJson(k(this.scope, "outbox"), []);
        this.emit({}, { pending: this.outbox.length });
      }
    };
    const onOnline = () => {
      this.emit({}, { online: true });
      this.backoff = 2000;
      this.diary.onOnline();
      void this.flush();
      void this.pull();
    };
    const onOffline = () => this.emit({}, { online: false, realtime: this.remote ? "connecting" : "off" });
    const onVisible = () => {
      // 숨을 때 일기는 바로 올리고, 돌아오면 열쇠·글을 다시 맞춘다
      if (document.visibilityState === "hidden") this.diary.flushSoon();
      if (document.visibilityState === "visible") {
        this.diary.onVisible();
        if (Date.now() - this.lastPull > 20_000) void this.pull();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    this.cleanups.push(() => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    });

    if (this.remote) {
      // 일정 등의 밀린 변경은 일정 받기만 기다린다 — 일기는 엔진이 켜질 때 스스로 받고 올린다(IndexedDB 가 느려도 안 막히게)
      void this.pullTables().then(() => this.flushOutbox());
      this.subscribeRealtime();
      this.pullTimer = window.setInterval(() => void this.pull(), 60_000);
    }
  }

  dispose() {
    this.diary.dispose();
    this.cleanups.forEach((c) => c());
    this.cleanups = [];
    if (this.flushTimer) window.clearTimeout(this.flushTimer);
    if (this.pullTimer) window.clearInterval(this.pullTimer);
    if (this.channel && this.remote) void this.remote.removeChannel(this.channel);
    this.channel = null;
    this.listeners.clear();
  }

  private load() {
    const db = readLocalDb(this.scope);
    this.outbox = readJson(k(this.scope, "outbox"), []);
    this.cursor = readJson(k(this.scope, "cursor"), {});
    this.emit({ db }, { pending: this.outbox.length });
  }

  private persist() {
    if (!writeJson(k(this.scope, "db"), this.snap.db))
      this.emit({}, { error: "이 기기 저장 공간이 꽉 찼어요 — 지금 바꾼 내용이 저장되지 않았어요" });
  }

  private persistOutbox() {
    writeJson(k(this.scope, "outbox"), this.outbox);
  }

  private ensureProfile() {
    if (this.snap.db.profile) return;
    const profile: Profile = {
      id: this.userId ?? "local",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul",
      grace_min: DEFAULT_SETTINGS.graceMin,
      settings: {},
      // 서버에 이미 있는 프로필을 이기지 않도록 아주 오래된 시각으로 둔다
      updated_at: new Date(0).toISOString(),
    };
    this.snap = { ...this.snap, db: { ...this.snap.db, profile } };
    this.persist();
  }

  /** 기본 카테고리(작업·개인·위시리스트·생일) — 한 번도 없었을 때만. id 가 결정적이라 기기마다 만들어도 하나로 합쳐짐 */
  private ensureDefaultCategories() {
    if (Object.keys(this.snap.db.categories).length > 0) return;
    const created = nowIso();
    for (const c of DEFAULT_CATEGORIES) {
      this.put(
        "categories",
        {
          id: defaultCategoryId(this.userId, c.slot),
          name: c.name,
          color: c.color,
          sort: c.slot,
          created_at: created,
          // 서버에 사용자가 고친 값이 있으면 그쪽이 이기게
          updated_at: new Date(0).toISOString(),
          deleted_at: null,
        },
        { mode: "insertIgnore", keepUpdatedAt: true },
      );
    }
  }

  // ───────────── 쓰기 ─────────────
  put<T extends TableName>(
    table: T,
    row: DB[T][string],
    opts: { mode?: "upsert" | "insertIgnore"; keepUpdatedAt?: boolean } = {},
  ) {
    const mode = opts.mode ?? "upsert";
    const existing = this.snap.db[table][row.id] as Row | undefined;
    if (mode === "insertIgnore" && existing) return;
    const next = {
      ...row,
      updated_at: opts.keepUpdatedAt ? row.updated_at : nowIso(),
      ...(this.userId ? { user_id: this.userId } : {}),
    } as DB[T][string];
    const db = { ...this.snap.db, [table]: { ...this.snap.db[table], [row.id]: next } } as DB;
    this.emit({ db });
    this.persist();
    // 사유 기록은 서버에서 고칠 수 없다(쓰기 전용) → 재전송돼도 '중복이면 무시'
    this.enqueue(table, next as unknown as Record<string, unknown>, table === "task_logs" ? "insertIgnore" : mode);
  }

  patch<T extends TableName>(table: T, id: string, patch: Partial<DB[T][string]>): DB[T][string] | null {
    const cur = this.snap.db[table][id];
    if (!cur) return null;
    const next = { ...cur, ...patch } as DB[T][string];
    this.put(table, next);
    return (this.snap.db[table][id] as DB[T][string] | undefined) ?? null;
  }

  saveProfile(patch: Partial<Profile>) {
    const cur = this.snap.db.profile;
    const next: Profile = {
      id: this.userId ?? "local",
      timezone: cur?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      grace_min: cur?.grace_min ?? DEFAULT_SETTINGS.graceMin,
      settings: cur?.settings ?? {},
      ...patch,
      updated_at: nowIso(),
    };
    this.emit({ db: { ...this.snap.db, profile: next } });
    this.persist();
    this.enqueue("profiles", next as unknown as Record<string, unknown>, "upsert");
  }

  /** 다른 저장소(로컬 모드)의 데이터를 이 계정으로 가져오기 */
  importDb(src: DB) {
    // 로컬 모드의 기본 카테고리 id → 이 계정의 기본 카테고리 id 로 바꿔 끼움(같은 '작업'이 두 개 생기지 않게)
    const remap = (id: string | null | undefined) => {
      const slot = localDefaultSlot(id);
      return slot ? defaultCategoryId(this.userId, slot) : (id ?? null);
    };
    // 예전 버전 백업의 일정엔 schedule/starred 가 없다 → 기본값으로 채워서 올린다
    const source: DB = { ...src, tasks: normalizeTasks(src.tasks ?? {}) };
    for (const t of TABLES) {
      for (const raw of Object.values(source[t] ?? {})) {
        let row = raw as Row & Record<string, unknown>;
        if (t === "categories") row = { ...row, id: remap(row.id) as string };
        if (t === "tasks" || t === "activities") row = { ...row, category_id: remap(row.category_id as string | null) };
        // 하루 노트 id 는 사용자+날짜로 정해진다 — 로컬 모드 id 그대로면 서버의 (사용자, 날짜) 고유 조건에 걸린다
        if (t === "day_notes") row = { ...row, id: dayNoteId(this.userId, String(row.day)) };
        const mine = this.snap.db[t][row.id] as Row | undefined;
        if (mine && mine.updated_at >= row.updated_at) continue;
        this.put(t, row as never, { keepUpdatedAt: true });
      }
    }
    if (src.profile?.settings) {
      this.saveProfile({
        settings: { ...src.profile.settings, ...(this.snap.db.profile?.settings ?? {}) },
        grace_min: src.profile.grace_min,
      });
    }
  }

  exportJson(): string {
    return JSON.stringify({ app: "must-planner", version: 1, exported_at: nowIso(), db: this.snap.db }, null, 2);
  }

  importJson(text: string): number {
    const parsed = JSON.parse(text) as { app?: string; db?: DB };
    if (parsed.app !== "must-planner" || !parsed.db) throw new Error("DREAM(예전 이름 MUST) 백업 파일이 아닙니다");
    const before = this.countRows();
    this.importDb({ ...emptyDb(), ...parsed.db });
    return this.countRows() - before;
  }

  private countRows() {
    return TABLES.reduce((n, t) => n + Object.keys(this.snap.db[t]).length, 0);
  }

  // ───────────── 동기화: 올리기 ─────────────
  private enqueue(table: AnyTable, row: Record<string, unknown>, mode: OutboxItem["mode"]) {
    if (!this.remote) return;
    const id = String(row.id);
    this.outbox = this.outbox.filter((o) => !(o.table === table && o.id === id));
    this.outbox.push({ table, id, mode, row, tries: 0 });
    this.persistOutbox();
    this.emit({}, { pending: this.outbox.length });
    this.scheduleFlush(250);
  }

  private scheduleFlush(ms: number) {
    if (!this.remote) return;
    if (this.flushTimer) window.clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => void this.flushOutbox(), ms);
  }

  /** 밀린 변경 올리기 — 일정 등(outbox)과 일기(따로) 둘 다 */
  async flush() {
    await Promise.all([this.flushOutbox(), this.diary.flush()]);
  }

  private async flushOutbox() {
    if (!this.remote || this.flushing || this.outbox.length === 0) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    this.flushing = true;
    const batch = [...this.outbox];
    const groups = new Map<string, OutboxItem[]>();
    for (const item of batch) {
      const key = `${item.table}|${item.mode}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    let networkFailed = false;
    const done = new Set<OutboxItem>();
    // 외래키 순서: 습관 → 일정 → 기록·집중 (일정보다 기록이 먼저 올라가면 거절된다)
    const order: AnyTable[] = [
      "profiles",
      "habits",
      "categories",
      "subjects",
      "tasks",
      "task_logs",
      "focus_sessions",
      "day_notes",
      "study_sessions",
      "career_entries",
      "activities",
    ];
    const sorted = [...groups].sort(
      ([a], [b]) => order.indexOf(a.split("|")[0] as AnyTable) - order.indexOf(b.split("|")[0] as AnyTable),
    );
    for (const [key, items] of sorted) {
      const [table, mode] = key.split("|") as [AnyTable, OutboxItem["mode"]];
      const rows = items.map((i) => i.row);
      const { error } = await this.remote
        .from(table)
        // 행마다 열이 다를 때 빠진 열을 NULL 로 채우지 않게 — 없는 열은 DB 기본값/기존 값 유지
        .upsert(rows, { onConflict: "id", ignoreDuplicates: mode === "insertIgnore", defaultToNull: false });
      if (!error) {
        items.forEach((i) => done.add(i));
        continue;
      }
      const msg = error.message ?? String(error);
      if (/fetch|network|Failed|timeout/i.test(msg)) {
        networkFailed = true;
        break;
      }
      // 권한·제약 오류 — 몇 번 재시도 후 버린다(로컬엔 남아 있음)
      console.warn("[must] 동기화 오류", table, msg);
      items.forEach((i) => {
        i.tries += 1;
        if (i.tries >= 5) done.add(i);
      });
      this.emit({}, { error: `${table}: ${msg}` });
    }
    // 보내는 사이 같은 행이 다시 바뀌었으면(새 항목으로 교체됨) 그 항목은 남긴다
    this.outbox = this.outbox.filter((o) => !done.has(o));
    this.persistOutbox();
    this.flushing = false;
    this.emit(
      {},
      {
        pending: this.outbox.length,
        lastSyncAt: done.size ? nowIso() : this.snap.status.lastSyncAt,
        error: networkFailed ? "오프라인 — 연결되면 자동으로 올립니다" : done.size ? null : this.snap.status.error,
      },
    );
    if (this.outbox.length) {
      this.scheduleFlush(this.backoff);
      this.backoff = Math.min(this.backoff * 2, 60_000);
    } else {
      this.backoff = 2000;
    }
  }

  // ───────────── 동기화: 받기 ─────────────
  /** Postgres 는 '2026-10-05T14:30:00+00:00' 형태로 준다 → 앱의 toISOString() 형태로 맞춰 문자열 비교·정렬이 어긋나지 않게 */
  private normalize(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...row };
    for (const [k, v] of Object.entries(out)) {
      const isTime = (k.endsWith("_at") && k !== "synced_at") || k === "planned_end";
      if (isTime && typeof v === "string") {
        const t = Date.parse(v);
        if (!Number.isNaN(t)) out[k] = new Date(t).toISOString();
      }
    }
    return out;
  }

  private applyRemote(table: AnyTable, raw: Record<string, unknown>): boolean {
    const row = this.normalize(raw);
    const id = String(row.id);
    const incoming = String(row.updated_at ?? "");
    const pending = this.outbox.find((o) => o.table === table && o.id === id);
    if (pending && String(pending.row.updated_at) > incoming) return false;
    if (table === "profiles") {
      const cur = this.snap.db.profile;
      if (cur && cur.updated_at > incoming) return false;
      this.snap = { ...this.snap, db: { ...this.snap.db, profile: row as unknown as Profile } };
      return true;
    }
    const cur = this.snap.db[table][id] as Row | undefined;
    if (cur && cur.updated_at > incoming) return false;
    this.snap = {
      ...this.snap,
      db: { ...this.snap.db, [table]: { ...this.snap.db[table], [id]: row } } as DB,
    };
    return true;
  }

  private bumpCursor(table: AnyTable, syncedAt: unknown) {
    if (typeof syncedAt !== "string") return;
    if (!this.cursor[table] || syncedAt > this.cursor[table]!) this.cursor[table] = syncedAt;
  }

  /** 받기 — 일정 등(TABLES)과 일기(따로) 둘 다 */
  async pull() {
    await Promise.all([this.pullTables(), this.diary.pull()]);
  }

  private async pullTables() {
    if (!this.remote || this.pulling) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    this.pulling = true;
    this.lastPull = Date.now();
    let changed = false;
    try {
      for (const table of [...TABLES, "profiles"] as AnyTable[]) {
        // 첫 쪽만 2분 겹쳐 받는다 — 늦게 커밋된 트랜잭션을 놓치지 않게(다시 받아도 LWW라 무해)
        const start = this.cursor[table];
        let after: string | null = start ? new Date(Date.parse(start) - 2 * 60_000).toISOString() : null;
        for (let page = 0; page < 20; page++) {
          let q = this.remote.from(table).select("*").order("synced_at", { ascending: true }).limit(500);
          if (after) q = q.gt("synced_at", after);
          // 날짜 없는 할 일은 starts_at 이 만든 시각이라 오래돼도 받아야 한다
          else if (table === "tasks")
            q = q.or(`starts_at.gte."${new Date(Date.now() - 60 * DAY).toISOString()}",schedule.eq.someday`);
          else if (table === "task_logs") q = q.gte("created_at", new Date(Date.now() - 60 * DAY).toISOString());
          else if (table === "focus_sessions")
            q = q.gte("started_at", new Date(Date.now() - 30 * DAY).toISOString());
          else if (table === "day_notes")
            q = q.gte("day", new Date(Date.now() - 400 * DAY).toISOString().slice(0, 10));
          else if (table === "study_sessions")
            q = q.gte("started_at", new Date(Date.now() - 400 * DAY).toISOString());
          else if (table === "activities")
            q = q.gte("day", new Date(Date.now() - 400 * DAY).toISOString().slice(0, 10));
          const { data, error } = await q;
          if (error) throw error;
          for (const row of data ?? []) {
            if (this.applyRemote(table, row)) changed = true;
            this.bumpCursor(table, row.synced_at);
          }
          if (!data || data.length < 500) break;
          after = String(data[data.length - 1].synced_at);
        }
      }
      writeJson(k(this.scope, "cursor"), this.cursor);
      if (changed) this.persist();
      this.emit({}, { lastSyncAt: nowIso(), error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      this.emit({}, { error: `받기 실패: ${msg}` });
    } finally {
      this.pulling = false;
    }
  }

  private subscribeRealtime() {
    if (!this.remote || !this.userId) return;
    const uid = this.userId;
    const ch = this.remote.channel(`must-sync-${uid}`);
    for (const table of [...TABLES, "profiles"] as AnyTable[]) {
      ch.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: table === "profiles" ? `id=eq.${uid}` : `user_id=eq.${uid}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined;
          if (!row || !("id" in row)) return;
          this.bumpCursor(table, row.synced_at);
          if (this.applyRemote(table, row)) {
            this.persist();
            this.emit({}, { lastSyncAt: nowIso() });
          }
        },
      );
    }
    this.emit({}, { realtime: "connecting" });
    this.diary.attachRealtime(ch);
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        this.emit({}, { realtime: "live" });
        void this.pull();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        this.emit({}, { realtime: "connecting" });
      } else if (status === "CLOSED") {
        this.emit({}, { realtime: "off" });
      }
    });
    this.channel = ch;
  }
}

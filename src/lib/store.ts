"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SETTINGS } from "./settings";
import { DAY, nowIso } from "./time";
import type { DB, Profile, Row, SyncStatus, TableName } from "./types";

/**
 * 로컬 우선(local-first) 저장소.
 *
 *  쓰기:  메모리 → localStorage(즉시) → outbox → (온라인이면) Supabase upsert
 *  읽기:  항상 메모리. 화면은 네트워크를 기다리지 않는다.
 *  받기:  Realtime(즉시) + synced_at 커서 기반 델타 pull(놓친 변경 보충)
 *  충돌:  updated_at 이 더 최신인 쪽이 이긴다(LWW). 서버도 같은 규칙의 트리거로 오래된 쓰기를 버린다.
 *
 * 그래서 비행기 안(오프라인)에서도 그대로 쓰고, 착륙 후 연결되면 밀린 변경이 올라간다.
 */

export const TABLES: TableName[] = ["tasks", "habits", "task_logs", "focus_sessions"];
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
}

const PREFIX = "must:v1";
const k = (scope: string, part: string) => `${PREFIX}:${scope}:${part}`;

const emptyDb = (): DB => ({ tasks: {}, habits: {}, task_logs: {}, focus_sessions: {}, profile: null });

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("[must] localStorage 저장 실패", e);
  }
}

export function hasLocalData(scope: string): boolean {
  const db = readJson<DB>(k(scope, "db"), emptyDb());
  return Object.keys(db.tasks ?? {}).length + Object.keys(db.habits ?? {}).length > 0;
}

export function readLocalDb(scope: string): DB {
  return { ...emptyDb(), ...readJson<DB>(k(scope, "db"), emptyDb()) };
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

  constructor(
    readonly scope: string,
    readonly userId: string | null,
    private remote: SupabaseClient | null,
  ) {
    this.snap = {
      db: emptyDb(),
      scope,
      userId,
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
    this.load();
    this.ensureProfile();

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
      void this.flush();
      void this.pull();
    };
    const onOffline = () => this.emit({}, { online: false, realtime: this.remote ? "connecting" : "off" });
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - this.lastPull > 20_000) void this.pull();
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
      void this.pull().then(() => this.flush());
      this.subscribeRealtime();
      this.pullTimer = window.setInterval(() => void this.pull(), 60_000);
    }
  }

  dispose() {
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
    writeJson(k(this.scope, "db"), this.snap.db);
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
    this.enqueue(table, next as unknown as Record<string, unknown>, mode);
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
    for (const t of TABLES) {
      for (const row of Object.values(src[t] ?? {})) {
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
    if (parsed.app !== "must-planner" || !parsed.db) throw new Error("MUST 백업 파일이 아닙니다");
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
    this.flushTimer = window.setTimeout(() => void this.flush(), ms);
  }

  async flush() {
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
    for (const [key, items] of groups) {
      const [table, mode] = key.split("|") as [AnyTable, OutboxItem["mode"]];
      const rows = items.map((i) => i.row);
      const { error } = await this.remote
        .from(table)
        .upsert(rows, { onConflict: "id", ignoreDuplicates: mode === "insertIgnore" });
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
  private applyRemote(table: AnyTable, row: Record<string, unknown>): boolean {
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

  async pull() {
    if (!this.remote || this.pulling) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    this.pulling = true;
    this.lastPull = Date.now();
    let changed = false;
    try {
      for (const table of [...TABLES, "profiles"] as AnyTable[]) {
        for (let page = 0; page < 20; page++) {
          let q = this.remote.from(table).select("*").order("synced_at", { ascending: true }).limit(500);
          const cur = this.cursor[table];
          if (cur) q = q.gt("synced_at", cur);
          else if (table === "tasks") q = q.gte("starts_at", new Date(Date.now() - 60 * DAY).toISOString());
          else if (table === "task_logs") q = q.gte("created_at", new Date(Date.now() - 60 * DAY).toISOString());
          else if (table === "focus_sessions")
            q = q.gte("started_at", new Date(Date.now() - 30 * DAY).toISOString());
          const { data, error } = await q;
          if (error) throw error;
          for (const row of data ?? []) {
            if (this.applyRemote(table, row)) changed = true;
            this.bumpCursor(table, row.synced_at);
          }
          if (!data || data.length < 500) break;
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

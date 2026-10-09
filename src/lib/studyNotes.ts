// 공부 노트 — 이 기기에 먼저 저장하고(인터넷이 없어도 됨), 연결되면 드라이브 'Study' 폴더에 올린다.
//   · 고칠 때마다 이 기기에 바로 저장, 서버엔 손을 멈추고 잠깐(기본 2.5초) 뒤·노트를 닫을 때·인터넷이 돌아왔을 때.
//   · 다른 기기(노트북 등)에서 쓴 노트도 목록에 뜬다 — 내용은 열 때 받아 온다.
//   · 두 기기에서 같은 노트를 동시에 고쳤으면 둘 다 남긴다(이 기기 것은 제목 끝에 '(이 기기)').
// 서버 쪽은 NoteBackend 로 갈아 끼운다(앱: drive.ts, 시험: 가짜) — React 없이 시험할 수 있게.

export interface RemoteNote {
  id: string;
  /** 파일 이름(…txt) */
  name: string;
  /** 서버에서 마지막으로 고친 때 */
  at: string;
}

export interface NoteBackend {
  list(): Promise<RemoteNote[]>;
  read(id: string): Promise<string>;
  create(name: string, text: string): Promise<RemoteNote>;
  /** base = 이 기기가 알던 그 판의 시각 — 서버 판이 다르면 NoteConflict */
  update(id: string, name: string, text: string, base: string): Promise<RemoteNote>;
  /** 이미 없으면 조용히 끝 */
  remove(id: string): Promise<void>;
}

/** 덮어쓰려는데 다른 기기가 그새 고침 */
export class NoteConflict extends Error {
  constructor(message = "다른 기기에서 먼저 고쳤어요.") {
    super(message);
    this.name = "NoteConflict";
  }
}

export interface StudyNote {
  /** 이 기기에서 붙인 번호 */
  id: string;
  title: string;
  /** null = 다른 기기에서 쓴 노트라 아직 내용을 안 받아 옴 */
  body: string | null;
  created_at: string;
  /** 마지막으로 고친 때 */
  updated_at: string;
  /** 드라이브에 있는 짝(id·그 판의 시각) — 없으면 아직 안 올림 */
  remote: { id: string; at: string } | null;
  /** 아직 못 올린 고침이 있다 */
  dirty: boolean;
  /** 지웠는데 서버엔 아직 남아 있음 */
  deleted?: boolean;
  /** 고칠 때마다 1씩 — 올리는 사이에 또 고쳤는지 알려고 */
  rev: number;
}

export type SyncStatus =
  /** 로그인 안 함 — 이 기기에만 */
  | "local"
  /** 다 올림 */
  | "idle"
  | "syncing"
  /** 인터넷 없음 — 이 기기에 저장해 두고 나중에 올림 */
  | "offline"
  | "error";

export interface NotesSnapshot {
  /** 지운 것 빼고, 최근에 고친 순 */
  notes: StudyNote[];
  status: SyncStatus;
  /** 오류 내용(사람이 읽는 말) */
  message: string | null;
  /** 아직 못 올린 노트 수 */
  pending: number;
  /** 이 기기에 저장하지 못함(저장 공간이 꽉 참 등) */
  saveFailed: boolean;
}

export interface NotesStorage {
  load(): StudyNote[] | null;
  save(notes: StudyNote[]): void;
}

export interface NotesOptions {
  isOnline?: () => boolean;
  now?: () => Date;
  uuid?: () => string;
  /** 손을 멈춘 뒤 올리기까지(ms) */
  delay?: number;
  /** 오류 → 사람이 읽는 말 */
  explain?: (e: unknown) => string;
  /** 여러 탭이 같은 노트를 동시에 올리지 않게 — 앱에선 navigator.locks */
  lock?: (fn: () => Promise<void>) => Promise<void>;
}

/** 기본 제목 — '10월 9일 공부 노트' */
export const defaultTitle = (d: Date): string => `${d.getMonth() + 1}월 ${d.getDate()}일 공부 노트`;

/** 노트 제목 → 파일 이름(경로 문자 빼고 .txt) */
export function noteFileName(title: string): string {
  const t = title.replace(/[\\/\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "제목 없는 노트";
  return `${t}.txt`;
}

/** 파일 이름 → 노트 제목 */
export const titleOf = (name: string): string => name.replace(/\.(txt|md)$/i, "").trim() || "제목 없는 노트";

/** 아무것도 안 쓴 새 노트 — 내용이 비었고 제목도 처음 그대로(또는 빈칸) */
export const isUntouched = (n: Pick<StudyNote, "body" | "title" | "created_at">): boolean =>
  !(n.body ?? "").trim() && (!n.title.trim() || n.title === defaultTitle(new Date(n.created_at)));
const time = (s: string) => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
};

function sane(raw: unknown): StudyNote[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((n): n is StudyNote => !!n && typeof n === "object" && typeof (n as StudyNote).id === "string" && typeof (n as StudyNote).title === "string")
    .map((n) => ({
      id: n.id,
      title: n.title,
      body: typeof n.body === "string" ? n.body : null,
      created_at: String(n.created_at ?? new Date(0).toISOString()),
      updated_at: String(n.updated_at ?? n.created_at ?? new Date(0).toISOString()),
      remote: n.remote && typeof n.remote.id === "string" ? { id: n.remote.id, at: String(n.remote.at ?? "") } : null,
      dirty: Boolean(n.dirty),
      ...(n.deleted ? { deleted: true } : {}),
      rev: Number(n.rev) || 0,
    }));
}

export class NotesStore {
  private notes: StudyNote[];
  private status: SyncStatus = "local";
  private message: string | null = null;
  private backend: NoteBackend | null = null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private saveFailed = false;
  /** 이 탭에서 치운 노트 — 다른 탭 저장본을 합칠 때 되살리지 않게 */
  private gone = new Set<string>();
  private snap: NotesSnapshot;
  private readonly isOnline: () => boolean;
  private readonly now: () => Date;
  private readonly uuid: () => string;
  private readonly delay: number;
  private readonly explain: (e: unknown) => string;
  private readonly lock: (fn: () => Promise<void>) => Promise<void>;

  constructor(
    private readonly storage: NotesStorage,
    opts: NotesOptions = {},
  ) {
    this.isOnline = opts.isOnline ?? (() => true);
    this.now = opts.now ?? (() => new Date());
    this.uuid = opts.uuid ?? (() => crypto.randomUUID());
    this.delay = opts.delay ?? 2500;
    this.explain = opts.explain ?? ((e) => String((e as { message?: string })?.message ?? e));
    this.lock = opts.lock ?? ((fn) => fn());
    let loaded: StudyNote[] = [];
    try {
      loaded = sane(storage.load());
    } catch {
      loaded = [];
    }
    this.notes = loaded;
    this.snap = this.makeSnap();
  }

  /* ── 구독(React useSyncExternalStore) ── */
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): NotesSnapshot => this.snap;

  private makeSnap(): NotesSnapshot {
    return {
      notes: this.notes.filter((n) => !n.deleted).sort((a, b) => time(b.updated_at) - time(a.updated_at)),
      status: this.status,
      message: this.message,
      pending: this.notes.filter((n) => n.dirty && n.body !== null && !(n.deleted && !n.remote) && !(isUntouched(n) && !n.remote && !n.deleted)).length,
      saveFailed: this.saveFailed,
    };
  }
  private emit(persist = true): void {
    if (persist) {
      try {
        this.storage.save(this.notes);
        this.saveFailed = false;
      } catch {
        // 저장 공간이 꽉 참 등 — 화면에 알린다(드라이브에 올라가면 안전)
        this.saveFailed = true;
      }
    }
    this.snap = this.makeSnap();
    for (const fn of this.listeners) fn();
  }
  private setStatus(status: SyncStatus, message: string | null = null): void {
    if (this.status === status && this.message === message) return;
    this.status = status;
    this.message = message;
    this.emit(false);
  }

  get(id: string): StudyNote | undefined {
    return this.notes.find((n) => n.id === id && !n.deleted);
  }
  /** 드라이브 파일 id 로 노트 찾기(드라이브 화면에서 열 때) */
  byRemote(remoteId: string): StudyNote | undefined {
    return this.notes.find((n) => n.remote?.id === remoteId && !n.deleted);
  }

  /**
   * 로그인 전에(이 기기에만) 쓴 노트를 이 계정으로 옮긴다 — 다음 맞추기에 드라이브로 올라간다.
   * 옮긴 수를 돌려준다
   */
  /** 다른 계정으로 옮길 만한(로그인 전에 쓴) 노트가 있는지 */
  hasImportable(): boolean {
    return this.notes.some((n) => !n.deleted && n.body !== null && !n.remote && !isUntouched(n));
  }

  importFrom(other: NotesStore): number {
    if (other === this) return 0;
    const take = other.notes.filter((n) => !n.deleted && n.body !== null && !n.remote && !isUntouched(n));
    if (!take.length) return 0;
    for (const n of take) {
      const id = this.notes.some((x) => x.id === n.id) ? this.uuid() : n.id;
      this.notes.push({ ...n, id, remote: null, dirty: true, rev: n.rev + 1 });
      other.drop(n);
    }
    other.emit();
    this.emit();
    this.schedule(0);
    return take.length;
  }

  /**
   * 다른 탭이 저장한 노트를 합친다(storage 이벤트) — 같은 노트면 더 많이 고친(rev) 쪽, 같으면 더 많이 올린 쪽.
   * 이 탭에서 치운 노트는 되살리지 않고, 이 탭에만 있는 새 노트·안 올린 고침은 남긴다
   */
  absorb(raw: unknown): void {
    const incoming = sane(raw);
    const inIds = new Set(incoming.map((n) => n.id));
    const byId = new Map(this.notes.map((n) => [n.id, n]));
    let changed = false;
    for (const inc of incoming) {
      if (this.gone.has(inc.id)) continue;
      const cur = byId.get(inc.id);
      if (!cur) {
        this.notes.push(inc);
        changed = true;
        continue;
      }
      const newer =
        inc.rev > cur.rev ||
        (inc.rev === cur.rev &&
          ((!inc.dirty && cur.dirty) || (!!inc.remote && (!cur.remote || time(inc.remote.at) > time(cur.remote.at))) || (!!inc.deleted && !cur.deleted)));
      if (!newer) continue;
      // 같은 판이면 이미 받아 둔 내용은 살린다
      const keepBody = inc.body === null && cur.body !== null && inc.remote && cur.remote && inc.remote.id === cur.remote.id && time(inc.remote.at) === time(cur.remote.at);
      Object.assign(cur, inc, keepBody ? { body: cur.body } : {});
      if (!inc.deleted) delete cur.deleted;
      changed = true;
    }
    // 다른 탭에서 사라진 노트: 이미 올려서 깨끗한 것만 치운다(드라이브에서 지워졌거나 그 탭이 지움)
    const before = this.notes.length;
    // (이 탭이 저장에 실패한 동안은 저장본이 낡았을 수 있으니 치우지 않는다)
    if (!this.saveFailed) this.notes = this.notes.filter((n) => inIds.has(n.id) || !n.remote || n.dirty);
    if (changed || this.notes.length !== before) this.emit();
  }

  /** 서버 연결(로그인) — null 이면 이 기기에만 */
  setBackend(b: NoteBackend | null): void {
    if (this.backend === b) return;
    this.backend = b;
    if (!b) {
      this.setStatus("local");
      return;
    }
    this.schedule(0);
  }

  /** 새 노트(빈 채로) — 아무것도 안 쓰고 닫으면 discardIfEmpty 로 치운다 */
  create(title?: string): StudyNote {
    const at = this.now().toISOString();
    const n: StudyNote = {
      id: this.uuid(),
      title: (title ?? defaultTitle(this.now())).slice(0, 120),
      body: "",
      created_at: at,
      updated_at: at,
      remote: null,
      dirty: true,
      rev: 0,
    };
    this.notes.push(n);
    this.emit();
    return n;
  }

  /** 고치기 — 이 기기엔 바로, 서버엔 손을 멈추고 잠깐 뒤 */
  edit(id: string, patch: { title?: string; body?: string }): void {
    const n = this.get(id);
    if (!n) return;
    if (patch.title !== undefined) n.title = patch.title.slice(0, 120);
    if (patch.body !== undefined) n.body = patch.body;
    n.rev++;
    n.dirty = true;
    n.updated_at = this.now().toISOString();
    this.emit();
    this.schedule();
  }

  /** 지우기 — 서버에 있으면 다음에 올릴 때 서버에서도 지운다 */
  remove(id: string): void {
    const n = this.get(id);
    if (!n) return;
    if (n.remote) {
      n.deleted = true;
      n.dirty = true;
      n.rev++;
    } else this.drop(n);
    this.emit();
    this.schedule(0);
  }

  private drop(n: StudyNote): void {
    this.notes = this.notes.filter((x) => x !== n);
    this.gone.add(n.id);
  }

  /** 아무것도 안 쓴 새 노트는 닫을 때 치운다 */
  discardIfEmpty(id: string): void {
    const n = this.get(id);
    if (n && !n.remote && isUntouched(n)) {
      this.drop(n);
      this.emit();
    }
  }

  /** 다른 기기에서 쓴 노트 내용 받기 */
  async load(id: string): Promise<string> {
    const n = this.get(id);
    if (!n) throw new Error("노트가 없어요.");
    if (n.body !== null) return n.body;
    if (!this.backend || !n.remote) throw new Error("로그인하면 볼 수 있어요.");
    if (!this.isOnline()) throw new Error("인터넷이 연결되면 볼 수 있어요.");
    const remoteId = n.remote.id;
    const text = await this.backend.read(remoteId);
    // 받는 사이에 고치거나 지웠으면 그대로 둔다
    const cur = this.get(id);
    if (cur && cur.body === null && cur.remote?.id === remoteId) {
      cur.body = text;
      this.emit();
    }
    return text;
  }

  /** 드라이브 화면에서 고른 파일을 노트로(없으면 목록에 넣고) */
  adopt(r: RemoteNote): StudyNote {
    const have = this.byRemote(r.id);
    if (have) {
      if (have.remote && time(have.remote.at) !== time(r.at)) {
        if (!have.dirty) {
          // 드라이브 목록이 더 새 판 → 다시 받는다
          have.title = titleOf(r.name);
          have.body = null;
          have.updated_at = r.at;
          have.remote = { id: r.id, at: r.at };
          this.emit();
        } else this.schedule(0); // 둘 다 고침 → 맞추기에서 둘 다 남긴다
      }
      return have;
    }
    const n: StudyNote = {
      id: this.uuid(),
      title: titleOf(r.name),
      body: null,
      created_at: r.at,
      updated_at: r.at,
      remote: { id: r.id, at: r.at },
      dirty: false,
      rev: 0,
    };
    this.notes.push(n);
    this.emit();
    return n;
  }

  /** 잠깐 뒤에 맞추기(이어 고치면 미뤄짐) */
  schedule(ms = this.delay): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync();
    }, ms);
  }

  /** 지금 맞추기 — 이미 하는 중이면 끝난 뒤 한 번 더 */
  sync(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.lock(async () => {
            // 다른 탭이 그새 올린 게 있으면 먼저 합친다(같은 노트를 두 번 만들지 않게)
            try {
              this.absorb(this.storage.load());
            } catch {
              /* 못 읽으면 이 탭 것으로 */
            }
            await this.syncOnce();
          });
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /** 닫을 때 — 남은 걸 바로 올린다 */
  flush(): Promise<void> {
    return this.notes.some((n) => n.dirty) ? this.sync() : Promise.resolve();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  private async syncOnce(): Promise<void> {
    const b = this.backend;
    if (!b) return this.setStatus("local");
    if (!this.isOnline()) return this.setStatus("offline");
    this.setStatus("syncing");
    try {
      await this.pull(b);
      await this.push(b);
      if (this.backend === b) this.setStatus("idle");
    } catch (e) {
      if (this.backend !== b) return;
      const offline = !this.isOnline() || /fetch|network|인터넷/i.test(String((e as { message?: string })?.message ?? e));
      this.setStatus(offline ? "offline" : "error", offline ? null : this.explain(e));
    }
  }

  /** 서버 목록과 맞추기 — 새 노트는 목록에, 남이 고친 건 다시 받게, 서버에서 지운 건 치운다 */
  private async pull(b: NoteBackend): Promise<void> {
    const remote = await b.list();
    if (this.backend !== b) return;
    const seen = new Set<string>();
    let changed = false;
    const mine = new Map(this.notes.filter((n) => n.remote).map((n) => [n.remote!.id, n]));
    for (const r of remote) {
      seen.add(r.id);
      const n = mine.get(r.id);
      if (!n) {
        this.notes.push({
          id: this.uuid(),
          title: titleOf(r.name),
          body: null,
          created_at: r.at,
          updated_at: r.at,
          remote: { id: r.id, at: r.at },
          dirty: false,
          rev: 0,
        });
        changed = true;
        continue;
      }
      // 판의 시각이 그대로면 그대로(기기마다 시계가 달라 '더 늦은지'가 아니라 '바뀌었는지'로 본다 — 우리가 올린 판은 그 시각을 적어 둠)
      if (time(r.at) === time(n.remote!.at)) continue;
      // 다른 기기에서 고침
      if (n.deleted) {
        // 여기선 지웠지만 저쪽에서 고쳤으면 살린다(고친 쪽이 이김)
        n.deleted = false;
        n.dirty = false;
        n.title = titleOf(r.name);
        n.body = null;
        n.updated_at = r.at;
        n.remote = { id: r.id, at: r.at };
      } else if (n.dirty && n.body !== null) {
        // 둘 다 고침 — 내용이 같으면(올리다 끊긴 우리 판 등) 그냥 맞춘다
        const theirs = await b.read(r.id).catch(() => null);
        if (this.backend !== b) return;
        if (theirs !== null && theirs === n.body) {
          n.remote = { id: r.id, at: r.at };
          if (noteFileName(n.title) === r.name) n.dirty = false;
          changed = true;
          continue;
        }
        // 정말 둘 다 고침 → 둘 다 남긴다: 이 기기 것은 새 노트로, 서버 것은 그 자리에
        n.remote = null;
        if (!n.title.endsWith("(이 기기)")) n.title = `${n.title} (이 기기)`.slice(0, 120);
        this.notes.push({
          id: this.uuid(),
          title: titleOf(r.name),
          body: null,
          created_at: r.at,
          updated_at: r.at,
          remote: { id: r.id, at: r.at },
          dirty: false,
          rev: 0,
        });
      } else {
        // 이 기기엔 고친 게 없음 → 저쪽 판으로(열려 있던 편집 창은 내용을 다시 받는다)
        n.title = titleOf(r.name);
        n.body = null;
        n.updated_at = r.at;
        n.remote = { id: r.id, at: r.at };
      }
      changed = true;
    }
    // 서버(드라이브 화면 등)에서 지운 노트
    const before = this.notes.length;
    this.notes = this.notes.filter((n) => {
      if (!n.remote || seen.has(n.remote.id)) return true;
      if (n.dirty && !n.deleted && n.body !== null) {
        n.remote = null; // 고친 게 있으면 새로 올린다
        changed = true;
        return true;
      }
      return false;
    });
    if (changed || this.notes.length !== before) this.emit();
  }

  /** 못 올린 고침 올리기 */
  private async push(b: NoteBackend): Promise<void> {
    for (const n of [...this.notes]) {
      if (this.backend !== b) return;
      if (!n.dirty) continue;
      if (n.deleted) {
        if (n.remote) await b.remove(n.remote.id);
        this.drop(n);
        this.emit();
        continue;
      }
      if (n.body === null) {
        // 내용을 안 받은 노트는 올릴 게 없다(편집 창은 받기 전엔 제목도 못 고침)
        n.dirty = false;
        this.emit();
        continue;
      }
      if (!n.remote && isUntouched(n)) continue; // 아무것도 안 쓴 새 노트는 안 올린다
      const rev = n.rev;
      const name = noteFileName(n.title);
      const text = n.body;
      let r: RemoteNote;
      if (n.remote) {
        try {
          r = await b.update(n.remote.id, name, text, n.remote.at);
        } catch (e) {
          if (e instanceof NoteConflict || (e as Error)?.name === "NoteConflict") {
            // 그새 다른 기기가 고침 → 이 기기 판은 새 노트로 올리고, 서버 판은 다음 맞추기에 따로 받는다
            n.remote = null;
            if (!n.title.endsWith("(이 기기)")) n.title = `${n.title} (이 기기)`.slice(0, 120);
            this.again = true;
            r = await b.create(noteFileName(n.title), text);
          } else if (/지워진|missing|not found|404/i.test(String((e as { message?: string })?.message ?? e))) {
            // 서버에서 그새 지워졌으면 새로 만든다
            r = await b.create(name, text);
          } else throw e;
        }
      } else r = await b.create(name, text);
      if (!this.notes.includes(n)) {
        // 올리는 사이에 지움 → 서버에서도 지운다
        await b.remove(r.id).catch(() => {});
        continue;
      }
      n.remote = { id: r.id, at: r.at };
      if (n.rev === rev) n.dirty = false;
      this.emit();
    }
  }
}

/** localStorage 에 두는 저장소(계정마다 따로) */
export function localNotesStorage(key: string): NotesStorage {
  return {
    load: () => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as StudyNote[]) : null;
      } catch {
        return null;
      }
    },
    save: (notes) => localStorage.setItem(key, JSON.stringify(notes)),
  };
}

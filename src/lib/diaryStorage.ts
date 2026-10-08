// 일기 저장소 — 이 기기의 IndexedDB 에 '잠긴 채로' 둔다. 평문은 메모리에만 있다.
//   keys: 일기 열쇠 꾸러미(CryptoKey 를 그대로 저장 — 구조화 복제)
//   rows: 잠긴 글(sealed) + 동기화 표시(dirty·ver)
//   meta: 받기 커서 같은 작은 값
// localStorage 와 달리 예전 빌드는 이 DB 를 모른다 → 예전 앱이 일기를 평문으로 올릴 일이 없다.

export interface StoredRow {
  id: string;
  day: string;
  sealed: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** 이 내용이 바탕으로 삼은 서버 판(dirty 면 base_ver). null = 아직 서버에 없음 */
  ver: number | null;
  synced_at: string | null;
  /** 아직 서버에 안 올라감 */
  dirty: boolean;
  err?: string | null;
  tries?: number;
}

/** 비밀번호 바꾸기 중인 열쇠 — 서버에 올리기 전까지 여기 둔다(중간에 꺼져도 이어서) */
export interface Pending {
  fromKid: string;
  kid: string;
  dek: CryptoKey;
  salt: string;
  iterations: number;
  wrapped: string;
  /** 새 비밀번호가 약한지(준비할 때 계산) */
  weak: boolean;
  /** 로그인 비밀번호가 정말 바뀐 뒤에만 true */
  confirmed: boolean;
}

export interface Keyring {
  /** 새 글을 잠글 열쇠 */
  current: string | null;
  keys: Record<string, CryptoKey>;
  weak: boolean;
  pending: Pending | null;
}

export interface DiaryStorage {
  /** 같은 저장소를 쓰는 탭끼리만 BroadcastChannel 을 나눈다(테스트에서 기기 흉내) */
  readonly scope?: string;
  getKeyring(uid: string): Promise<Keyring | null>;
  putKeyring(uid: string, k: Keyring): Promise<void>;
  /** 열쇠 꾸러미 읽고-고치고-쓰기를 한 트랜잭션으로(두 탭이 동시에 바꿔도 열쇠가 사라지지 않게). fn 은 동기, null = 안 바꿈 */
  updateKeyring(uid: string, fn: (cur: Keyring | null) => Keyring | null): Promise<Keyring | null>;
  rows(uid: string): Promise<StoredRow[]>;
  getRow(uid: string, id: string): Promise<StoredRow | null>;
  /** 한 번의 읽기·쓰기 트랜잭션. fn 은 반드시 동기(암호화는 미리). null = 안 바꿈. 결과 행을 돌려준다 */
  updateRow(uid: string, id: string, fn: (cur: StoredRow | null) => StoredRow | null): Promise<StoredRow | null>;
  getMeta(uid: string, name: string): Promise<string | null>;
  putMeta(uid: string, name: string, v: string): Promise<void>;
  wipe(uid: string): Promise<void>;
}

const copyRow = (r: StoredRow): StoredRow => ({ ...r });
const copyRing = (k: Keyring): Keyring => ({ ...k, keys: { ...k.keys }, pending: k.pending ? { ...k.pending } : null });

// ───────────── IndexedDB ─────────────
const DB_NAME = "must-diary";

type Stored = StoredRow & { uid: string };
const strip = (s: Stored): StoredRow => {
  const { uid: _uid, ...row } = s;
  void _uid;
  return row;
};

export function idbDiaryStorage(): DiaryStorage {
  let dbp: Promise<IDBDatabase> | null = null;

  // 처음 쓸 때 연다(만들 때 열면 SSR·로그아웃 상태에서도 IndexedDB 를 건드린다)
  const open = (): Promise<IDBDatabase> => {
    if (dbp) return dbp;
    const p = new Promise<IDBDatabase>((resolve, reject) => {
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("keys")) db.createObjectStore("keys");
        if (!db.objectStoreNames.contains("rows"))
          db.createObjectStore("rows", { keyPath: ["uid", "id"] }).createIndex("by_uid", "uid");
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      };
      req.onsuccess = () => {
        const db = req.result;
        // 다른 탭이 새 버전으로 올리면 비켜 준다
        db.onversionchange = () => {
          db.close();
          dbp = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    });
    dbp = p;
    p.catch(() => {
      if (dbp === p) dbp = null;
    });
    return p;
  };

  /** 트랜잭션 하나 — body 안의 콜백은 동기로만. 끝까지 커밋돼야 값을 돌려준다 */
  async function run<T>(
    stores: string[],
    mode: IDBTransactionMode,
    body: (t: IDBTransaction, set: (v: T) => void, fail: (e: unknown) => void) => void,
  ): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      let out: T;
      let err: unknown = null;
      let t: IDBTransaction;
      try {
        t = db.transaction(stores, mode);
      } catch (e) {
        reject(e);
        return;
      }
      const fail = (e: unknown) => {
        err = e;
        try {
          t.abort();
        } catch {
          // 이미 끝남
        }
      };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(err ?? t.error);
      t.onabort = () => reject(err ?? t.error ?? new Error("transaction aborted"));
      try {
        body(t, (v) => (out = v), fail);
      } catch (e) {
        fail(e);
      }
    });
  }

  return {
    async getKeyring(uid) {
      return run<Keyring | null>(["keys"], "readonly", (t, set) => {
        const r = t.objectStore("keys").get(uid);
        r.onsuccess = () => set((r.result as Keyring | undefined) ?? null);
      });
    },
    async putKeyring(uid, k) {
      await run<void>(["keys"], "readwrite", (t) => {
        t.objectStore("keys").put(k, uid);
      });
    },
    async updateKeyring(uid, fn) {
      return run<Keyring | null>(["keys"], "readwrite", (t, set, fail) => {
        const store = t.objectStore("keys");
        const r = store.get(uid);
        r.onsuccess = () => {
          try {
            const cur = (r.result as Keyring | undefined) ?? null;
            const next = fn(cur);
            if (next === null) {
              set(cur);
              return;
            }
            store.put(next, uid);
            set(next);
          } catch (e) {
            fail(e);
          }
        };
      });
    },
    async rows(uid) {
      return run<StoredRow[]>(["rows"], "readonly", (t, set) => {
        const r = t.objectStore("rows").index("by_uid").getAll(uid);
        r.onsuccess = () => set((r.result as Stored[]).map(strip));
      });
    },
    async getRow(uid, id) {
      return run<StoredRow | null>(["rows"], "readonly", (t, set) => {
        const r = t.objectStore("rows").get([uid, id]);
        r.onsuccess = () => set(r.result ? strip(r.result as Stored) : null);
      });
    },
    async updateRow(uid, id, fn) {
      return run<StoredRow | null>(["rows"], "readwrite", (t, set, fail) => {
        const store = t.objectStore("rows");
        const r = store.get([uid, id]);
        r.onsuccess = () => {
          try {
            const cur = r.result ? strip(r.result as Stored) : null;
            const next = fn(cur);
            if (next === null) {
              set(cur);
              return;
            }
            store.put({ ...next, id, uid });
            set({ ...next, id });
          } catch (e) {
            fail(e);
          }
        };
      });
    },
    async getMeta(uid, name) {
      return run<string | null>(["meta"], "readonly", (t, set) => {
        const r = t.objectStore("meta").get(`${uid}:${name}`);
        r.onsuccess = () => set(typeof r.result === "string" ? r.result : null);
      });
    },
    async putMeta(uid, name, v) {
      await run<void>(["meta"], "readwrite", (t) => {
        t.objectStore("meta").put(v, `${uid}:${name}`);
      });
    },
    async wipe(uid) {
      await run<void>(["keys", "rows", "meta"], "readwrite", (t, _set, fail) => {
        t.objectStore("keys").delete(uid);
        const rows = t.objectStore("rows");
        const c = rows.index("by_uid").openKeyCursor(IDBKeyRange.only(uid));
        c.onsuccess = () => {
          try {
            const cur = c.result;
            if (!cur) return;
            rows.delete(cur.primaryKey);
            cur.continue();
          } catch (e) {
            fail(e);
          }
        };
        t.objectStore("meta").delete(IDBKeyRange.bound(`${uid}:`, `${uid}:￿`));
      });
    },
  };
}

// ───────────── 메모리(테스트) ─────────────
/** IndexedDB 와 같은 약속을 지키는 Map 저장소. 같은 인스턴스를 두 엔진에 주면 '같은 기기의 두 탭' */
export function memoryDiaryStorage(): DiaryStorage {
  const keys = new Map<string, Keyring>();
  const rows = new Map<string, Map<string, StoredRow>>();
  const meta = new Map<string, string>();
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));
  const bucket = (uid: string) => {
    let b = rows.get(uid);
    if (!b) rows.set(uid, (b = new Map()));
    return b;
  };
  return {
    scope: Math.random().toString(36).slice(2),
    async getKeyring(uid) {
      await tick();
      const k = keys.get(uid);
      return k ? copyRing(k) : null;
    },
    async putKeyring(uid, k) {
      await tick();
      keys.set(uid, copyRing(k));
    },
    async updateKeyring(uid, fn) {
      await tick();
      const cur = keys.get(uid) ?? null;
      const next = fn(cur ? copyRing(cur) : null);
      if (next === null) return cur ? copyRing(cur) : null;
      keys.set(uid, copyRing(next));
      return copyRing(next);
    },
    async rows(uid) {
      await tick();
      return [...bucket(uid).values()].map(copyRow);
    },
    async getRow(uid, id) {
      await tick();
      const r = bucket(uid).get(id);
      return r ? copyRow(r) : null;
    },
    async updateRow(uid, id, fn) {
      await tick();
      const b = bucket(uid);
      const cur = b.get(id) ?? null;
      const next = fn(cur ? copyRow(cur) : null);
      if (next === null) return cur ? copyRow(cur) : null;
      b.set(id, copyRow({ ...next, id }));
      return copyRow({ ...next, id });
    },
    async getMeta(uid, name) {
      await tick();
      return meta.get(`${uid}:${name}`) ?? null;
    },
    async putMeta(uid, name, v) {
      await tick();
      meta.set(`${uid}:${name}`, v);
    },
    async wipe(uid) {
      await tick();
      keys.delete(uid);
      rows.delete(uid);
      for (const k of [...meta.keys()]) if (k.startsWith(`${uid}:`)) meta.delete(k);
    },
  };
}

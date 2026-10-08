// 일기 서버 쪽 — Supabase 호출만 모아 둔다(테스트에선 PGlite 로 바꿔 끼움).
// 서버엔 잠긴 글(sealed)과 감싼 열쇠(wrapped)만 간다. 평문·비밀번호는 절대 여기로 안 온다(비밀번호 확인 빼고).
import type { SupabaseClient } from "@supabase/supabase-js";

export interface KeyRow {
  kid: string;
  salt: string;
  iterations: number;
  wrapped: string;
  ring: { kid: string; w: string }[];
  needs_rewrap: boolean;
  rev: number;
}

export interface ServerEntry {
  id: string;
  day: string;
  sealed: string;
  ver: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  synced_at: string;
}

/** 올리는 열 — 이 7개 말고는 절대 보내지 않는다 */
export interface PushRow {
  id: string;
  day: string;
  sealed: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  base_ver: number | null;
}

export type KeyPatch = Partial<Omit<KeyRow, "rev">>;

/** 인터넷 문제 — 나중에 다시 하면 되는 실패 */
export class NetworkError extends Error {
  constructor(message?: string) {
    super(message ?? "network");
    this.name = "NetworkError";
  }
}
export const isNetworkError = (e: unknown): boolean =>
  e instanceof NetworkError || (e instanceof Error && e.name === "NetworkError");

export interface DiaryRemote {
  /** 로그인 비밀번호가 맞는지 서버(Auth)에 물어본다. 인터넷 문제면 NetworkError */
  verifyPassword(pw: string): Promise<"ok" | "wrong">;
  getKeyRow(): Promise<KeyRow | null>;
  /** false = 이미 다른 기기가 만들어 둠 */
  insertKeyRow(r: { kid: string; salt: string; iterations: number; wrapped: string; ring: KeyRow["ring"] }): Promise<boolean>;
  /** rev 가 그대로일 때만 바꾼다. null = 그새 다른 기기가 바꿈 */
  casKeyRow(rev: number, patch: KeyPatch): Promise<KeyRow | null>;
  setNeedsRewrap(): Promise<void>;
  /** null = 서버가 버림(다른 기기가 먼저 고침) */
  pushEntry(r: PushRow): Promise<{ ver: number; synced_at: string } | null>;
  getEntry(id: string): Promise<ServerEntry | null>;
  pullEntries(after: string | null, limit: number): Promise<ServerEntry[]>;
}

// store.ts 와 같은 기준으로 '인터넷 문제'를 가른다
const NET_RE = /fetch|network|Failed|timeout/i;
const ENTRY_COLS = "id,day,sealed,ver,created_at,updated_at,deleted_at,synced_at";
const KEY_COLS = "kid,salt,iterations,wrapped,ring,needs_rewrap,rev";

function toError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String((e as { message?: string } | null)?.message ?? e);
  return NET_RE.test(msg) ? new NetworkError(msg) : new Error(msg);
}

/** supabase-js 결과 → 값, 오류는 NetworkError/Error 로 던짐 */
async function call<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  let res: { data: T; error: unknown };
  try {
    res = await p;
  } catch (e) {
    throw toError(e);
  }
  if (res.error) throw toError(res.error);
  return res.data;
}

export function supabaseDiaryRemote(sb: SupabaseClient, uid: string): DiaryRemote {
  return {
    async verifyPassword(pw) {
      const { data } = await sb.auth.getSession();
      const email = data.session?.user?.email;
      if (!email || data.session?.user?.id !== uid) throw new NetworkError("no session");
      let error: { message?: string; code?: string } | null;
      try {
        // 같은 계정으로 세션이 하나 더 생긴다 — uid 가 같아서 앱은 그대로
        ({ error } = await sb.auth.signInWithPassword({ email, password: pw }));
      } catch (e) {
        throw toError(e);
      }
      if (!error) return "ok";
      if (error.code === "invalid_credentials" || /invalid login credentials/i.test(error.message ?? "")) return "wrong";
      throw toError(error);
    },
    async getKeyRow() {
      return call<KeyRow | null>(sb.from("diary_keys").select(KEY_COLS).maybeSingle());
    },
    async insertKeyRow(r) {
      const data = await call<{ rev: number }[] | null>(
        sb.from("diary_keys").upsert(r, { onConflict: "user_id", ignoreDuplicates: true }).select("rev"),
      );
      return (data ?? []).length === 1;
    },
    async casKeyRow(rev, patch) {
      const data = await call<KeyRow[] | null>(
        sb.from("diary_keys").update(patch).eq("user_id", uid).eq("rev", rev).select(KEY_COLS),
      );
      return data?.[0] ?? null;
    },
    async setNeedsRewrap() {
      await call(sb.from("diary_keys").update({ needs_rewrap: true }).eq("user_id", uid));
    },
    async pushEntry(r) {
      const data = await call<{ ver: number; synced_at: string }[] | null>(
        sb.from("diary_entries").upsert(r, { onConflict: "id" }).select("ver,synced_at"),
      );
      return data?.[0] ?? null;
    },
    async getEntry(id) {
      return call<ServerEntry | null>(sb.from("diary_entries").select(ENTRY_COLS).eq("id", id).maybeSingle());
    },
    async pullEntries(after, limit) {
      let q = sb.from("diary_entries").select(ENTRY_COLS).order("synced_at", { ascending: true }).limit(limit);
      if (after) q = q.gt("synced_at", after);
      return (await call<ServerEntry[] | null>(q)) ?? [];
    },
  };
}

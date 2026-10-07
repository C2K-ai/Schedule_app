// admin 함수의 순수 로직(요청 검사·금지 규칙) — index.ts 와 테스트가 같이 쓴다

export type TargetAction =
  | "ban"
  | "unban"
  | "signout"
  | "reset_password"
  | "recovery_link"
  | "confirm"
  | "make_admin"
  | "remove_admin"
  | "delete";

type LinkAction = "reset_password" | "recovery_link";

export type Action =
  | { action: "overview" }
  | { action: "users" }
  | { action: "settings"; signups_open?: boolean; ai_daily_limit?: number }
  | { action: Exclude<TargetAction, "delete" | LinkAction>; user_id: string }
  | { action: LinkAction; user_id: string; redirect_to: string | null }
  | { action: "delete"; user_id: string; confirm_email: string };

const TARGET: TargetAction[] = ["ban", "unban", "signout", "reset_password", "recovery_link", "confirm", "make_admin", "remove_admin", "delete"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 스스로 잠그는 사고를 막는다 — 나를 정지·삭제하거나 내 관리자 권한을 뺄 수 없다 */
export const SELF_FORBIDDEN = new Set<TargetAction>(["ban", "delete", "remove_admin"]);
/** 관리자는 정지·삭제 전에 관리자 해제부터 */
export const ADMIN_TARGET_FORBIDDEN = new Set<TargetAction>(["ban", "delete"]);

/** 비밀번호 재설정 메일의 돌아올 주소 — https(또는 내 컴퓨터의 http) 만 */
export function safeRedirect(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 500) return null;
  try {
    const u = new URL(v);
    if (u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))) {
      return u.toString();
    }
  } catch {
    // 잘못된 주소
  }
  return null;
}

export function parseAction(body: unknown): Action | { error: string } {
  if (!body || typeof body !== "object") return { error: "bad_body" };
  const b = body as Record<string, unknown>;
  const a = b.action;
  if (a === "overview" || a === "users") return { action: a };
  if (a === "settings") {
    const out: { action: "settings"; signups_open?: boolean; ai_daily_limit?: number } = { action: "settings" };
    if (b.signups_open !== undefined) {
      if (typeof b.signups_open !== "boolean") return { error: "bad_signups_open" };
      out.signups_open = b.signups_open;
    }
    if (b.ai_daily_limit !== undefined) {
      const n = b.ai_daily_limit;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 1000) return { error: "bad_ai_daily_limit" };
      out.ai_daily_limit = n;
    }
    if (out.signups_open === undefined && out.ai_daily_limit === undefined) return { error: "nothing_to_change" };
    return out;
  }
  if (typeof a === "string" && (TARGET as string[]).includes(a)) {
    if (typeof b.user_id !== "string" || !UUID.test(b.user_id)) return { error: "bad_user_id" };
    const user_id = b.user_id.toLowerCase();
    if (a === "delete") {
      if (typeof b.confirm_email !== "string" || !b.confirm_email.trim()) return { error: "confirm_email" };
      return { action: "delete", user_id, confirm_email: b.confirm_email.trim() };
    }
    if (a === "reset_password" || a === "recovery_link") return { action: a, user_id, redirect_to: safeRedirect(b.redirect_to) };
    return { action: a as Exclude<TargetAction, "delete" | LinkAction>, user_id };
  }
  return { error: "unknown_action" };
}

/** 대상 작업을 해도 되는지 — 안 되면 오류 코드 */
export function guard(action: TargetAction, opts: { self: boolean; targetIsAdmin: boolean }): string | null {
  if (opts.self && SELF_FORBIDDEN.has(action)) return "self";
  if (opts.targetIsAdmin && ADMIN_TARGET_FORBIDDEN.has(action)) return "target_admin";
  return null;
}

/** 삭제 확인 — 대상 이메일을 그대로 다시 적어야 한다(대소문자 무시) */
export const emailMatches = (typed: string, actual: string | null | undefined) =>
  Boolean(actual) && typed.trim().toLowerCase() === actual!.trim().toLowerCase();

/** 사실상 영구 정지(100년) */
export const BAN_FOREVER = "876000h";

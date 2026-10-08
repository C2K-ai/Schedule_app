// signup 함수의 순수 로직(요청 검사·오류 분류) — index.ts 와 테스트가 같이 쓴다

/** 한 번에 쌓여 있을 수 있는 승인 대기 수 — 넘으면 관리자가 정리할 때까지 신청을 받지 않는다(장난 가입 막기) */
export const MAX_PENDING = 20;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseSignup(body: unknown): { name: string; email: string; password: string } | { error: string } {
  if (!body || typeof body !== "object") return { error: "bad_body" };
  const b = body as Record<string, unknown>;
  // 이름 — 관리자가 누군지 보고 승인하도록. 제어 문자는 빼고 공백은 하나로
  const name = typeof b.name === "string" ? b.name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const password = typeof b.password === "string" ? b.password : "";
  if (!name || name.length > 40) return { error: "bad_name" };
  if (!email || email.length > 254 || !EMAIL.test(email)) return { error: "bad_email" };
  if (password.length < 6) return { error: "weak_password" };
  if (password.length > 72) return { error: "long_password" };
  return { name, email, password };
}

/** 계정 만들기 오류 → 앱에 돌려줄 코드와 상태 */
export function createError(e: { code?: string; status?: number; message?: string }): { error: string; status: number } {
  const m = (e.message ?? "").toLowerCase();
  if (e.code === "email_exists" || m.includes("already been registered") || m.includes("already registered")) {
    return { error: "exists", status: 409 };
  }
  if (e.code === "weak_password" || m.includes("password")) return { error: "weak_password", status: 400 };
  // 가입이 닫혀 있으면 DB 트리거(must_single_owner)가 막는다 → GoTrue 는 'Database error creating new user'
  if (m.includes("database error")) return { error: "closed", status: 403 };
  return { error: "internal", status: 500 };
}

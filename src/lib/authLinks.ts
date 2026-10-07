"use client";

// 메일 링크(로그인·비밀번호 재설정)로 앱에 들어왔을 때의 처리

const RECOVERY_KEY = "must:pw-recovery";
/** 비밀번호 재설정 링크로 들어온 순간 PlannerProvider 가 알린다 */
export const RECOVERY_EVENT = "must:pw-recovery";

export function markRecovery() {
  try {
    sessionStorage.setItem(RECOVERY_KEY, "1");
  } catch {
    /* 사생활 보호 모드 등 — 이벤트만으로 충분 */
  }
  window.dispatchEvent(new Event(RECOVERY_EVENT));
}

export function inRecovery(): boolean {
  try {
    return sessionStorage.getItem(RECOVERY_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearRecovery() {
  try {
    sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* 무시 */
  }
}

/** 주소 끝(#error=…)에 붙어 온 인증 오류 → 알아듣기 쉬운 말. 오류가 없으면 null */
export function linkErrorMessage(hash: string): string | null {
  const h = new URLSearchParams(hash.replace(/^#/, ""));
  const code = h.get("error_code") ?? h.get("error");
  if (!code) return null;
  if (code === "otp_expired")
    return "메일 링크가 만료됐거나 이미 쓴 링크예요. 링크는 1시간 안에, 가장 최근 메일 것만 한 번 쓸 수 있어요 — 다시 받거나 비밀번호로 로그인하세요.";
  if (code === "access_denied") return "메일 링크로 로그인하지 못했어요. 다시 받거나 비밀번호로 로그인하세요.";
  const desc = h.get("error_description");
  return `메일 링크 오류: ${desc ? desc.replace(/\+/g, " ") : code}`;
}

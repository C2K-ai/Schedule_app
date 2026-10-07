// AI 함수 공용 — 하루 사용 한도 확인 · 사용 기록(토큰 수). 관리자 화면이 이 기록으로 비용을 보여 준다.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface Quota {
  used: number;
  limit: number;
  admin: boolean;
}

/** 오늘 한도를 다 썼는지 — 관리자는 한도 없음 */
export const overLimit = (q: Quota) => !q.admin && q.used >= q.limit;

export async function quota(db: SupabaseClient, userId: string): Promise<Quota> {
  const { data, error } = await db.rpc("must_ai_quota", { p_user: userId });
  if (error) throw new Error(`AI 한도 확인 실패: ${error.message}`);
  const q = (data ?? {}) as Partial<Quota>;
  return { used: Number(q.used ?? 0), limit: Number(q.limit ?? 0), admin: q.admin === true };
}

interface Usage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** 입력(캐시 포함)·출력 토큰 */
export function tokens(u: Usage | null | undefined): { input_tokens: number; output_tokens: number } {
  const n = (x: number | null | undefined) => (Number.isFinite(x) && (x as number) > 0 ? Math.round(x as number) : 0);
  return {
    input_tokens: n(u?.input_tokens) + n(u?.cache_creation_input_tokens) + n(u?.cache_read_input_tokens),
    output_tokens: n(u?.output_tokens),
  };
}

/** 사용 기록 — 실패해도 사용자의 요청은 그대로 끝낸다 */
export async function logUsage(db: SupabaseClient, userId: string, fn: string, model: string, usage: Usage | null | undefined) {
  const { error } = await db.from("ai_usage").insert({ user_id: userId, fn, model, ...tokens(usage) });
  if (error) console.error("ai_usage 기록 실패:", error.message);
}

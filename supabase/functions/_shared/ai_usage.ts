// AI 함수 공용 — 하루 사용 한도와 사용 기록(토큰 수). 관리자 화면이 이 기록으로 비용을 보여 준다.
//   부르기 전에 claim() 으로 한 칸 예약(한도 확인 + 기록이 한 번에 — 동시에 여러 번 눌러도 못 넘는다),
//   끝나면 finish() 로 실제 모델·토큰을 채우고, 서버가 오류로 답해 청구되지 않았으면 release() 로 돌려준다.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface Claim {
  ok: boolean;
  id: number | null;
  used: number;
  limit: number;
  admin: boolean;
}

export async function claim(db: SupabaseClient, userId: string, fn: string, model: string): Promise<Claim> {
  const { data, error } = await db.rpc("must_ai_claim", { p_user: userId, p_fn: fn, p_model: model });
  if (error) throw new Error(`AI 한도 확인 실패: ${error.message}`);
  const c = (data ?? {}) as Partial<Claim>;
  const id = typeof c.id === "number" ? c.id : null;
  return { ok: c.ok === true && id !== null, id, used: Number(c.used ?? 0), limit: Number(c.limit ?? 0), admin: c.admin === true };
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

/** 예약한 칸에 실제 모델·토큰을 채운다 — 실패해도 사용자의 요청은 그대로 끝낸다 */
export async function finish(db: SupabaseClient, id: number, model: string, usage: Usage | null | undefined) {
  const { error } = await db.from("ai_usage").update({ model, ...tokens(usage) }).eq("id", id);
  if (error) console.error("ai_usage 기록 실패:", error.message);
}

/** 청구되지 않은 호출(서버가 오류로 답함)이면 예약을 돌려준다 */
export async function release(db: SupabaseClient, id: number) {
  const { error } = await db.from("ai_usage").delete().eq("id", id);
  if (error) console.error("ai_usage 예약 취소 실패:", error.message);
}

/** 서버가 상태 코드로 답한 오류는 청구되지 않는다 — 시간 초과·연결 끊김(상태 없음)은 청구됐을 수 있어 남긴다 */
export const unbilled = (e: unknown) => typeof (e as { status?: unknown } | null)?.status === "number";

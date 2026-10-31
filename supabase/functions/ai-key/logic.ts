// ai-key 의 순수 로직 — index.ts 와 시험이 같이 쓴다

/** Claude API 키 모양(DB must_set_ai_key 검사와 같게). 콘솔에서 복사할 때 붙는 앞뒤 공백·줄바꿈은 지운다 */
export function cleanKey(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const k = v.trim();
  return k.length >= 30 && k.length <= 300 && /^sk-ant-[A-Za-z0-9_-]+$/.test(k) ? k : null;
}

/** Anthropic 시험 요청이 실패한 이유 → 앱이 알아듣는 오류 이름 */
export function testError(status: number | undefined, message: string): string {
  if (status === 401) return "key_rejected";
  if (status === 403) return "key_no_permission";
  if (status === 400 && /credit|balance|billing/i.test(message)) return "no_credit";
  if (status === 429 || status === 529) return "rate_limited";
  return "key_test_failed";
}

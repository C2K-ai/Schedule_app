// 설정 → 알림 → "서버 푸시 테스트" — 로그인한 사용자의 모든 기기로 테스트 푸시
//   배포: npx supabase functions deploy push-test   (JWT 검증 켜 둔 채로)
import { admin, cors, json, sendToUser, VIBRATIONS } from "../_shared/push.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const db = admin();
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) return json({ error: "unauthorized" }, 401);

  const r = await sendToUser(db, data.user.id, {
    title: "🔔 MUST 서버 푸시 테스트",
    body: "앱을 완전히 닫아도 정각·미시작 알림이 이렇게 옵니다.",
    tag: `must-test-${Date.now()}`,
    kind: "before",
    requireInteraction: false,
    vibrate: VIBRATIONS.double,
  });
  return json(r);
});

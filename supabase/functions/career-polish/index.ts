// 커리어 기록 다듬기 — 내가 대충 적은 메모 + 그 기간에 끝낸 일정·하루 노트 → 이력서용 제목·요약·문장·기술
//   배포: npx supabase functions deploy career-polish   (JWT 검증 켠 채로 — 로그인한 주인만)
//   키:   parse-schedule 과 같은 Vault 'must_anthropic_key' / ANTHROPIC_API_KEY
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { claim, finish, release, unbilled } from "../_shared/ai_usage.ts";
import { admin, cors, json, setting } from "../_shared/env.ts";
import { buildPrompt, cleanPolished, SCHEMA, SYSTEM, type Material, type Polished } from "./logic.ts";

// 이력서 문장은 글솜씨와 '없는 사실 안 지어내기'가 중요해 한 단계 위 모델로(드물게 써서 비용 차이 작음, 1번 약 20~40원)
const MODEL = "claude-sonnet-5-5";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const db = admin();
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !auth.user) return json({ error: "unauthorized" }, 401);
  const userId = auth.user.id;

  let body: Material;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const prompt = buildPrompt(body);
  if (!prompt) return json({ error: "empty" }, 400);

  let apiKey: string;
  try {
    apiKey = await setting("ANTHROPIC_API_KEY");
  } catch {
    return json({ error: "no_api_key" }, 503);
  }

  // 한 사람의 하루 한도(관리자 화면 → 설정) — 한 칸 예약. 확인을 못 하면 비용이 새지 않게 막는다
  let slot: number;
  try {
    const c = await claim(db, userId, "career-polish", MODEL);
    if (!c.ok || c.id === null) return json({ error: "daily_limit", limit: c.limit }, 429);
    slot = c.id;
  } catch (e) {
    console.error(e);
    return json({ error: "quota_check" }, 503);
  }

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      // 글 다듬기는 low 로 충분 — 생각을 짧게 해 빠르고 싸다
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    await finish(db, slot, res.model ?? MODEL, res.usage);
    if (res.stop_reason === "refusal") return json({ error: "refused" }, 422);
    if (res.stop_reason === "max_tokens") return json({ error: "too_long" }, 422);
    const out = res.content.find((b) => b.type === "text");
    if (!out || out.type !== "text") return json({ error: "no_output" }, 502);
    return json(cleanPolished(JSON.parse(out.text) as Polished));
  } catch (e) {
    if (unbilled(e)) await release(db, slot);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "bad_api_key" }, 503);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: "api", status: e.status, message: e.message }, 502);
    if (e instanceof SyntaxError) return json({ error: "bad_output" }, 502);
    return json({ error: "internal", message: String(e) }, 500);
  }
});

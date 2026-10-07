// 커리어 기록 다듬기 — 내가 대충 적은 메모 + 그 기간에 끝낸 일정·하루 노트 → 이력서용 제목·요약·문장·기술
//   배포: npx supabase functions deploy career-polish   (JWT 검증 켠 채로 — 로그인한 주인만)
//   키:   parse-schedule 과 같은 Vault 'must_anthropic_key' / ANTHROPIC_API_KEY
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { admin, cors, json, setting } from "../_shared/env.ts";
import { buildPrompt, cleanPolished, SCHEMA, SYSTEM, type Material, type Polished } from "./logic.ts";

const MODEL = "claude-opus-5-5";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await admin().auth.getUser(jwt);
  if (authErr || !auth.user) return json({ error: "unauthorized" }, 401);

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

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // 사실만 골라 문장으로 다듬는 일 — 기본(medium)으로
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    if (res.stop_reason === "refusal") return json({ error: "refused" }, 422);
    if (res.stop_reason === "max_tokens") return json({ error: "too_long" }, 422);
    const out = res.content.find((b) => b.type === "text");
    if (!out || out.type !== "text") return json({ error: "no_output" }, 502);
    return json(cleanPolished(JSON.parse(out.text) as Polished));
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "bad_api_key" }, 503);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: "api", status: e.status, message: e.message }, 502);
    if (e instanceof SyntaxError) return json({ error: "bad_output" }, 502);
    return json({ error: "internal", message: String(e) }, 500);
  }
});

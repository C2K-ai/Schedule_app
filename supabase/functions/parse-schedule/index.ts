// 말(또는 대충 쓴 문장) → 일정 목록. 앱이 미리보기로 보여 주고, 사용자가 확인하면 앱이 저장한다.
//   배포: npx supabase functions deploy parse-schedule   (JWT 검증 켠 채로 — 로그인한 주인만)
//   키:   Vault 'must_anthropic_key' 또는 Edge Function 비밀값 ANTHROPIC_API_KEY
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { admin, cors, json, setting } from "../_shared/env.ts";
import { calendarTable, clean, isDate, isTime, SCHEMA, SYSTEM, WEEKDAYS, type RawItem } from "./logic.ts";

const MODEL = "claude-opus-5-5";
const MAX_TEXT = 2000;

interface Body {
  text?: unknown;
  /** 사용자 기기 기준 오늘 YYYY-MM-DD */
  today?: unknown;
  /** 사용자 기기 기준 지금 HH:MM */
  time?: unknown;
  categories?: unknown;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await admin().auth.getUser(jwt);
  if (authErr || !auth.user) return json({ error: "unauthorized" }, 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return json({ error: "empty" }, 400);
  if (text.length > MAX_TEXT) return json({ error: "too_long", max: MAX_TEXT }, 400);
  if (!isDate(body.today) || !isTime(body.time)) return json({ error: "bad_clock" }, 400);
  const today = body.today;
  const categories = (Array.isArray(body.categories) ? body.categories : [])
    .filter((c): c is { id: string; name: string } => typeof c?.id === "string" && typeof c?.name === "string")
    .slice(0, 50);

  let apiKey: string;
  try {
    apiKey = await setting("ANTHROPIC_API_KEY");
  } catch {
    return json({ error: "no_api_key" }, 503);
  }

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 });
  const userMsg = [
    `지금: ${today} ${WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()]}요일 ${body.time}`,
    `달력:\n${calendarTable(today)}`,
    `카테고리: ${categories.length ? categories.map((c) => c.name).join(", ") : "(없음)"}`,
    `사용자가 한 말:\n"""\n${text}\n"""`,
  ].join("\n\n");

  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // 짧은 추출이라 낮은 effort 로 빠르게 — 이해력이 부족하면 "medium" 으로 올린다
      output_config: { effort: (Deno.env.get("AI_EFFORT") as "low" | "medium" | "high") ?? "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    });
    if (res.stop_reason === "refusal") return json({ error: "refused" }, 422);
    if (res.stop_reason === "max_tokens") return json({ error: "too_long" }, 422);
    const out = res.content.find((b) => b.type === "text");
    if (!out || out.type !== "text") return json({ error: "no_output" }, 502);
    const parsed = JSON.parse(out.text) as { items: RawItem[]; reply: string };
    const items = parsed.items.map((r) => clean(r, categories, today)).filter((x) => x !== null);
    return json({ items, reply: parsed.reply });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "bad_api_key" }, 503);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: "api", status: e.status, message: e.message }, 502);
    if (e instanceof SyntaxError) return json({ error: "bad_output" }, 502);
    return json({ error: "internal", message: String(e) }, 500);
  }
});

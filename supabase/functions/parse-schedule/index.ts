// 말(또는 대충 쓴 문장) → 일정 목록. 앱이 미리보기로 보여 주고, 사용자가 확인하면 앱이 저장한다.
//   배포: npx supabase functions deploy parse-schedule   (JWT 검증 켠 채로 — 로그인한 주인만)
//   키:   Vault 'must_anthropic_key' 또는 Edge Function 비밀값 ANTHROPIC_API_KEY
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { claim, finish, release, unbilled } from "../_shared/ai_usage.ts";
import { admin, cors, json, setting } from "../_shared/env.ts";
import { calendarTable, clean, isDate, isTime, SCHEMA, SYSTEM, WEEKDAYS, type RawItem } from "./logic.ts";

// 짧은 추출이라 빠르고 싼 Haiku 로 충분하다 — 5.5 는 4.5 보다 10배 싸다(한 번 약 1원 미만)
const MODEL = "claude-haiku-5-5";
const MAX_TEXT = 2000;

interface Body {
  /** true 면 Claude 를 부르지 않고 키가 있는지만 알려 준다(설정 화면용) */
  ping?: unknown;
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

  const db = admin();
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !auth.user) return json({ error: "unauthorized" }, 401);
  const userId = auth.user.id;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  if (body.ping === true) {
    const ready = await setting("ANTHROPIC_API_KEY").then(Boolean, () => false);
    return json({ ready, model: MODEL });
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

  // 한 사람의 하루 한도(관리자 화면 → 설정) — 한 칸 예약. 확인을 못 하면 비용이 새지 않게 막는다
  let slot: number;
  try {
    const c = await claim(db, userId, "parse-schedule", MODEL);
    if (!c.ok || c.id === null) return json({ error: "daily_limit", limit: c.limit }, 429);
    slot = c.id;
  } catch (e) {
    console.error(e);
    return json({ error: "quota_check" }, 503);
  }

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 });
  const userMsg = [
    `지금: ${today} ${WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()]}요일 ${body.time}`,
    `달력:\n${calendarTable(today)}`,
    `카테고리: ${categories.length ? categories.map((c) => c.name).join(", ") : "(없음)"}`,
    `사용자가 한 말:\n"""\n${text}\n"""`,
  ].join("\n\n");

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      // 날짜 표를 보고 옮겨 적는 일이라 생각 단계 없이도 정확하다(시험 결과) — 더 빠르고 싸다
      thinking: { type: "disabled" },
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    });
    await finish(db, slot, res.model ?? MODEL, res.usage);
    if (res.stop_reason === "refusal") return json({ error: "refused" }, 422);
    if (res.stop_reason === "max_tokens") return json({ error: "too_long" }, 422);
    const out = res.content.find((b) => b.type === "text");
    if (!out || out.type !== "text") return json({ error: "no_output" }, 502);
    const parsed = JSON.parse(out.text) as { items: RawItem[]; reply: string };
    const items = parsed.items.map((r) => clean(r, categories, today)).filter((x) => x !== null);
    return json({ items, reply: parsed.reply });
  } catch (e) {
    if (unbilled(e)) await release(db, slot);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "bad_api_key" }, 503);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: "api", status: e.status, message: e.message }, 502);
    if (e instanceof SyntaxError) return json({ error: "bad_output" }, 502);
    return json({ error: "internal", message: String(e) }, 500);
  }
});

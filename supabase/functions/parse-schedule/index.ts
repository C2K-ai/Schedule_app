// 말(또는 대충 쓴 문장) → 일정 목록. 앱이 미리보기로 보여 주고, 사용자가 확인하면 앱이 저장한다.
//   배포: npx supabase functions deploy parse-schedule   (JWT 검증 켠 채로 — 로그인한 주인만)
//   키:   Vault 'must_anthropic_key' 또는 Edge Function 비밀값 ANTHROPIC_API_KEY
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { claim, finish, release, unbilled } from "../_shared/ai_usage.ts";
import { admin, cors, json, setting } from "../_shared/env.ts";
import {
  calendarTable,
  checkExisting,
  checkCategories,
  checkImage,
  clean,
  cleanClass,
  cleanRemove,
  isDate,
  isTime,
  mergeClasses,
  SCHEMA,
  SYSTEM,
  TIMETABLE_SCHEMA,
  TIMETABLE_SYSTEM,
  WEEKDAYS,
  type RawClass,
  type RawItem,
} from "./logic.ts";

// 짧은 추출이라 빠르고 싼 Haiku 로 충분하다 — 5.5 는 4.5 보다 10배 싸다(한 번 약 1원 미만)
const MODEL = "claude-haiku-5-5";
// 시간표 사진은 칸의 위·아래 끝으로 시각을 읽어야 해서 Sonnet — 시험에서 Haiku 는 끝 시각을 16개 중 7개 틀림, Sonnet 은 다 맞음.
// 한 학기에 한두 번이라 비용은 괜찮다
const TIMETABLE_MODEL = "claude-sonnet-5-5";
// 사진(카톡 캡처·공지)도 Sonnet — 가짜 카톡 캡처 시험에서 Haiku 는 "다음 주 수요일까지"를 이번 주로 넣음, Sonnet 은 맞음. 글만 오면 Haiku
const PHOTO_MODEL = "claude-sonnet-5-5";
const MAX_TEXT = 2000;

interface Body {
  /** true 면 Claude 를 부르지 않고 키가 있는지만 알려 준다(설정 화면용) */
  ping?: unknown;
  text?: unknown;
  /** 사진 한 장 { media_type, data(base64) } — 시간표·공지·초대장 등. 있으면 글은 없어도 된다 */
  image?: unknown;
  /** "timetable" 이면 시간표 사진(또는 글) → 수업 목록 { classes, reply } */
  mode?: unknown;
  /** 지우기·옮기기 말이 있을 때만 — 기존 일정 [{ref, when, title}] (ref: t1…·h1…·m1…) */
  existing?: unknown;
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
  const image = checkImage(body.image);
  if (image === "bad_image" || image === "image_too_big") return json({ error: image }, 400);
  if (!text && !image) return json({ error: "empty" }, 400);
  if (text.length > MAX_TEXT) return json({ error: "too_long", max: MAX_TEXT }, 400);
  if (!isDate(body.today) || !isTime(body.time)) return json({ error: "bad_clock" }, 400);
  const today = body.today;
  const categories = checkCategories(body.categories);
  const timetable = body.mode === "timetable";
  const existing = timetable ? [] : checkExisting(body.existing);
  const model = timetable ? TIMETABLE_MODEL : image ? PHOTO_MODEL : MODEL;

  let apiKey: string;
  try {
    apiKey = await setting("ANTHROPIC_API_KEY");
  } catch {
    return json({ error: "no_api_key" }, 503);
  }

  // 한 사람의 하루 한도(관리자 화면 → 설정) — 한 칸 예약. 확인을 못 하면 비용이 새지 않게 막는다
  let slot: number;
  try {
    const c = await claim(db, userId, timetable ? "parse-timetable" : "parse-schedule", model);
    if (!c.ok || c.id === null) return json({ error: "daily_limit", limit: c.limit }, 429);
    slot = c.id;
  } catch (e) {
    console.error(e);
    return json({ error: "quota_check" }, 503);
  }

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 });
  if (timetable) {
    const msg = image
      ? `사용자가 시간표 사진을 보냈어요.${text ? `\n사용자가 덧붙인 말:\n"""\n${text}\n"""` : ""}`
      : `사용자가 시간표를 글로 적었어요:\n"""\n${text}\n"""`;
    const content: Anthropic.Messages.MessageParam["content"] = image
      ? [
          { type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } },
          { type: "text", text: msg },
        ]
      : msg;
    try {
      const res = await client.messages.create(
        {
          model,
          max_tokens: 6000,
          output_config: { effort: "low", format: { type: "json_schema", schema: TIMETABLE_SCHEMA } },
          system: TIMETABLE_SYSTEM,
          messages: [{ role: "user", content }],
        },
        { timeout: 90_000 },
      );
      await finish(db, slot, res.model ?? model, res.usage);
      if (res.stop_reason === "refusal") return json({ error: "refused" }, 422);
      if (res.stop_reason === "max_tokens") return json({ error: "too_long" }, 422);
      const out = res.content.find((b) => b.type === "text");
      if (!out || out.type !== "text") return json({ error: "no_output" }, 502);
      const parsed = JSON.parse(out.text) as { classes: RawClass[]; reply: string };
      const classes = mergeClasses(parsed.classes.map(cleanClass).filter((x) => x !== null)).slice(0, 40);
      return json({ classes, reply: parsed.reply });
    } catch (e) {
      return await failed(e, db, slot);
    }
  }
  const userMsg = [
    `지금: ${today} ${WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()]}요일 ${body.time}`,
    `달력:\n${calendarTable(today)}`,
    `카테고리: ${categories.length ? categories.map((c) => c.name).join(", ") : "(없음)"}`,
    ...(existing.length ? [`기존 일정(지우거나 옮길 때만 씀, ref | 언제 | 제목):\n${existing.map((e) => `${e.ref} | ${e.when} | ${e.title}`).join("\n")}`] : []),
    image
      ? `사용자가 사진을 보냈어요. 사진 속 일정을 찾아 주세요.${text ? `\n사용자가 덧붙인 말:\n"""\n${text}\n"""` : ""}`
      : `사용자가 한 말:\n"""\n${text}\n"""`,
  ].join("\n\n");

  try {
    const format = { type: "json_schema" as const, schema: SCHEMA };
    const res = await client.messages.create(
      {
        model,
        max_tokens: 8000,
        // 글: 날짜 표를 보고 옮겨 적는 일이라 Haiku 가 생각 단계 없이도 정확하다(시험 결과) — 더 빠르고 싸다. 사진: Sonnet 이 조금만 생각
        ...(model === MODEL
          ? { thinking: { type: "disabled" as const }, output_config: { format } }
          : { output_config: { effort: "low" as const, format } }),
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: image
              ? [
                  { type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } },
                  { type: "text", text: userMsg },
                ]
              : userMsg,
          },
        ],
      },
      { timeout: image ? 90_000 : 45_000 },
    );
    await finish(db, slot, res.model ?? model, res.usage);
    if (res.stop_reason === "refusal") return json({ error: "refused" }, 422);
    if (res.stop_reason === "max_tokens") return json({ error: "too_long" }, 422);
    const out = res.content.find((b) => b.type === "text");
    if (!out || out.type !== "text") return json({ error: "no_output" }, 502);
    const parsed = JSON.parse(out.text) as { items: RawItem[]; remove?: unknown; reply: string };
    const items = parsed.items.map((r) => clean(r, categories, today)).filter((x) => x !== null);
    return json({ items, remove: cleanRemove(parsed.remove, existing), reply: parsed.reply });
  } catch (e) {
    return await failed(e, db, slot);
  }
});

/** Claude 호출이 실패했을 때 — 청구 안 됐으면 한도 칸을 돌려주고 앱이 알아볼 오류로 */
async function failed(e: unknown, db: ReturnType<typeof admin>, slot: number) {
  if (unbilled(e)) await release(db, slot);
  if (e instanceof Anthropic.AuthenticationError) return json({ error: "bad_api_key" }, 503);
  if (e instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
  if (e instanceof Anthropic.APIError) return json({ error: "api", status: e.status, message: e.message }, 502);
  if (e instanceof SyntaxError) return json({ error: "bad_output" }, 502);
  return json({ error: "internal", message: String(e) }, 500);
}

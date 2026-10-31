// 관리자: Claude API 키 바꾸기 — 관리자 화면에 붙여 넣은 새 키를 Anthropic 에 아주 짧게 시험해 보고(답 1토큰, 1원도 안 됨)
//   맞을 때만 Vault(must_anthropic_key)에 넣는다. 키 값은 돌려주지도, 로그에 남기지도 않는다(알아보기용 앞뒤 몇 글자만).
//   배포: verify_jwt true. 부른 사람이 must_admins 에 있을 때만 — 나머지는 403.
//   Edge 비밀값 ANTHROPIC_API_KEY 가 따로 있으면 그쪽이 먼저 쓰인다(setting() 순서) — env_override 로 알려 준다.
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { admin, cors, json } from "../_shared/env.ts";
import { cleanKey, testError } from "./logic.ts";

// 시험은 가장 싼 모델로 — 키가 맞는지, 그 조직에 잔액이 있는지까지 본다
const TEST_MODEL = "claude-haiku-5-5";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const db = admin();
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !auth.user) return json({ error: "unauthorized" }, 401);
  const { data: mine, error: adminErr } = await db.from("must_admins").select("user_id").eq("user_id", auth.user.id).maybeSingle();
  if (adminErr) return json({ error: "db" }, 500);
  if (!mine) return json({ error: "forbidden" }, 403);

  let body: { action?: unknown; key?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const envOverride = Boolean(Deno.env.get("ANTHROPIC_API_KEY"));

  if (body.action === "info") {
    const { data, error } = await db.rpc("must_ai_key_hint");
    if (error) return json({ error: "db" }, 500);
    return json({ ...(data as Record<string, unknown>), env_override: envOverride });
  }
  if (body.action !== "set") return json({ error: "bad_action" }, 400);

  const key = cleanKey(body.key);
  if (!key) return json({ error: "bad_key" }, 400);
  try {
    await new Anthropic({ apiKey: key, maxRetries: 0, timeout: 20_000 }).messages.create({
      model: TEST_MODEL,
      max_tokens: 1,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: "ping" }],
    });
  } catch (e) {
    return json({ error: e instanceof Anthropic.APIError ? testError(e.status, e.message) : "key_test_failed" }, 400);
  }
  const { data, error } = await db.rpc("must_set_ai_key", { p_key: key });
  if (error) return json({ error: "save_failed" }, 500);
  return json({ ok: true, ...(data as Record<string, unknown>), env_override: envOverride });
});

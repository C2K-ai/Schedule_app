// 가입 신청 — 메일 확인 없이 계정을 만들고 '승인 대기'로 둔다(DB 트리거 must_new_member). 관리자 휴대폰으로 알림.
//   배포: npx supabase functions deploy signup --no-verify-jwt   (로그인 전 화면에서 부른다)
//   관리자 화면 → 설정 → '가입 신청 받기'가 켜져 있을 때만. 승인은 관리자 화면 → 사용자.
//   메일 확인을 거치지 않는 대신 관리자가 아는 사람인지 보고 승인한다(기본 메일 서버의 시간당 발송 한도도 피한다).
import { admin, cors, json, sendToUser, VIBRATIONS } from "../_shared/push.ts";
import { createError, MAX_PENDING, parseSignup } from "./logic.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const p = parseSignup(body);
  if ("error" in p) return json(p, 400);

  const db = admin();
  try {
    const { data: s, error: sErr } = await db.from("must_app_settings").select("signups_open").eq("id", true).maybeSingle();
    if (sErr) throw sErr;
    if (!s?.signups_open) return json({ error: "closed" }, 403);
    const { count, error: cErr } = await db.from("must_members").select("user_id", { count: "exact", head: true }).eq("approved", false);
    if (cErr) throw cErr;
    if ((count ?? 0) >= MAX_PENDING) return json({ error: "too_many" }, 429);

    // 이름은 user_metadata 로 — DB 트리거가 승인 표(must_members.name)로 옮긴다
    const { data: created, error } = await db.auth.admin.createUser({
      email: p.email,
      password: p.password,
      email_confirm: true,
      user_metadata: { name: p.name },
    });
    if (error || !created.user) {
      const e = createError(error ?? {});
      if (e.error === "internal") console.error("signup createUser", error?.message);
      return json({ error: e.error }, e.status);
    }

    // 관리자 기기로 알림 — 실패해도 가입은 됐다(관리자 화면에 '승인 대기'로 보인다)
    const { data: admins } = await db.from("must_admins").select("user_id");
    await Promise.all(
      (admins ?? []).map((a) =>
        sendToUser(db, a.user_id, {
          title: "🙋 새 가입 신청",
          body: `${p.name} (${p.email}) — 눌러서 관리자 화면에서 승인하세요`,
          tag: `must-signup-${created.user.id}`,
          kind: "signup",
          requireInteraction: false,
          vibrate: VIBRATIONS.double,
          openAction: "admin",
        }, 24 * 3600).catch((e) => console.error("signup push", String(e))),
      ),
    );
    return json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
    console.error("signup", message);
    return json({ error: "internal" }, 500);
  }
});

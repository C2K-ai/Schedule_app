// deno test admin/logic.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { emailMatches, guard, parseAction, safeRedirect } from "./logic.ts";
import { tokens, unbilled } from "../_shared/ai_usage.ts";

const U = "11111111-2222-4333-8444-555555555555";

Deno.test("요청 검사: 보기·설정", () => {
  assertEquals(parseAction({ action: "overview" }), { action: "overview" });
  assertEquals(parseAction({ action: "users" }), { action: "users" });
  assertEquals(parseAction({ action: "settings", signups_open: true }), { action: "settings", signups_open: true });
  assertEquals(parseAction({ action: "settings", ai_daily_limit: 50 }), { action: "settings", ai_daily_limit: 50 });
  assertEquals(parseAction({ action: "settings" }), { error: "nothing_to_change" });
  assertEquals(parseAction({ action: "settings", signups_open: "yes" }), { error: "bad_signups_open" });
  assertEquals(parseAction({ action: "settings", ai_daily_limit: 1.5 }), { error: "bad_ai_daily_limit" });
  assertEquals(parseAction({ action: "settings", ai_daily_limit: -1 }), { error: "bad_ai_daily_limit" });
  assertEquals(parseAction({ action: "settings", ai_daily_limit: 1001 }), { error: "bad_ai_daily_limit" });
  assertEquals(parseAction({ action: "drop_everything" }), { error: "unknown_action" });
  assertEquals(parseAction(null), { error: "bad_body" });
});

Deno.test("요청 검사: 사용자 작업", () => {
  assertEquals(parseAction({ action: "ban", user_id: U }), { action: "ban", user_id: U });
  assertEquals(parseAction({ action: "ban", user_id: U.toUpperCase() }), { action: "ban", user_id: U });
  assertEquals(parseAction({ action: "ban", user_id: "x' or 1=1" }), { error: "bad_user_id" });
  assertEquals(parseAction({ action: "delete", user_id: U }), { error: "confirm_email" });
  assertEquals(parseAction({ action: "delete", user_id: U, confirm_email: " a@x " }), { action: "delete", user_id: U, confirm_email: "a@x" });
  assertEquals(parseAction({ action: "reset_password", user_id: U, redirect_to: "https://c2k-ai.github.io/Schedule_app/" }), {
    action: "reset_password",
    user_id: U,
    redirect_to: "https://c2k-ai.github.io/Schedule_app/",
  });
  assertEquals(parseAction({ action: "reset_password", user_id: U, redirect_to: "javascript:alert(1)" }), { action: "reset_password", user_id: U, redirect_to: null });
  assertEquals(parseAction({ action: "recovery_link", user_id: U, redirect_to: "https://a.b/" }), { action: "recovery_link", user_id: U, redirect_to: "https://a.b/" });
  assertEquals(parseAction({ action: "confirm", user_id: U }), { action: "confirm", user_id: U });
});

Deno.test("돌아올 주소: https 와 내 컴퓨터만", () => {
  assertEquals(safeRedirect("https://a.b/c"), "https://a.b/c");
  assertEquals(safeRedirect("http://localhost:3000/"), "http://localhost:3000/");
  assertEquals(safeRedirect("http://evil.example/"), null);
  assertEquals(safeRedirect("data:text/html,hi"), null);
  assertEquals(safeRedirect(42), null);
});

Deno.test("금지 규칙: 나 자신·다른 관리자", () => {
  assertEquals(guard("ban", { self: true, targetIsAdmin: true }), "self");
  assertEquals(guard("delete", { self: true, targetIsAdmin: true }), "self");
  assertEquals(guard("remove_admin", { self: true, targetIsAdmin: true }), "self");
  assertEquals(guard("signout", { self: true, targetIsAdmin: true }), null);
  assertEquals(guard("reset_password", { self: true, targetIsAdmin: true }), null);
  assertEquals(guard("ban", { self: false, targetIsAdmin: true }), "target_admin");
  assertEquals(guard("delete", { self: false, targetIsAdmin: true }), "target_admin");
  assertEquals(guard("remove_admin", { self: false, targetIsAdmin: true }), null);
  assertEquals(guard("ban", { self: false, targetIsAdmin: false }), null);
});

Deno.test("삭제 확인 이메일", () => {
  assertEquals(emailMatches("A@X.com ", "a@x.com"), true);
  assertEquals(emailMatches("a@x.co", "a@x.com"), false);
  assertEquals(emailMatches("a@x.com", null), false);
});

Deno.test("AI 사용 기록: 토큰 계산·청구 안 된 오류 구분", () => {
  assertEquals(unbilled({ status: 529 }), true);
  assertEquals(unbilled({ status: undefined }), false);
  assertEquals(unbilled(new SyntaxError("x")), false);
  assertEquals(unbilled(null), false);
  assertEquals(tokens({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: null }), { input_tokens: 105, output_tokens: 20 });
  assertEquals(tokens(undefined), { input_tokens: 0, output_tokens: 0 });
  assertEquals(tokens({ input_tokens: -3, output_tokens: Number.NaN }), { input_tokens: 0, output_tokens: 0 });
});

Deno.test("가입 승인 요청", () => {
  const id = "AAAAAAAA-0000-4000-8000-000000000001";
  assertEquals(parseAction({ action: "approve", user_id: id }), { action: "approve", user_id: id.toLowerCase() });
  assertEquals(parseAction({ action: "approve" }), { error: "bad_user_id" });
  assertEquals(guard("approve", { self: true, targetIsAdmin: true }), null);
});

Deno.test("드라이브 용량 설정", () => {
  assertEquals(parseAction({ action: "settings", drive_quota_mb: 300 }), { action: "settings", drive_quota_mb: 300 });
  assertEquals(parseAction({ action: "settings", drive_quota_mb: -1 }), { error: "bad_drive_quota_mb" });
  assertEquals(parseAction({ action: "settings", drive_quota_mb: 1.5 }), { error: "bad_drive_quota_mb" });
  assertEquals(parseAction({ action: "settings" }), { error: "nothing_to_change" });
});

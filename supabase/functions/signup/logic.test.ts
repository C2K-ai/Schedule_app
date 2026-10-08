import { assertEquals } from "jsr:@std/assert@1";
import { createError, parseSignup } from "./logic.ts";

Deno.test("가입 신청 검사", () => {
  const n = { name: "홍길동" };
  assertEquals(parseSignup({ ...n, email: "  Friend@Naver.com ", password: "secret12" }), { name: "홍길동", email: "friend@naver.com", password: "secret12" });
  assertEquals(parseSignup({ ...n, email: "nope", password: "secret12" }), { error: "bad_email" });
  assertEquals(parseSignup({ ...n, email: "a@b.co", password: "12345" }), { error: "weak_password" });
  // 일기를 같은 비밀번호로 잠그므로 새 비밀번호는 8자부터 — 7자는 안 된다
  assertEquals(parseSignup({ ...n, email: "a@b.co", password: "secret1" }), { error: "weak_password" });
  assertEquals(parseSignup({ ...n, email: "a@b.co", password: "x".repeat(73) }), { error: "long_password" });
  assertEquals(parseSignup(null), { error: "bad_body" });
  assertEquals(parseSignup({ ...n, email: 3, password: "secret12" }), { error: "bad_email" });
  assertEquals(parseSignup({ email: "a@b.co", password: "secret12" }), { error: "bad_name" });
  assertEquals(parseSignup({ name: "   ", email: "a@b.co", password: "secret12" }), { error: "bad_name" });
  assertEquals(parseSignup({ name: "가".repeat(41), email: "a@b.co", password: "secret12" }), { error: "bad_name" });
  assertEquals((parseSignup({ name: " 김\n  철수\t", email: "a@b.co", password: "secret12" }) as { name: string }).name, "김 철수");
});

Deno.test("계정 만들기 오류 분류", () => {
  assertEquals(createError({ code: "email_exists", message: "A user with this email address has already been registered" }), { error: "exists", status: 409 });
  assertEquals(createError({ code: "weak_password", message: "Password should be at least 6 characters." }), { error: "weak_password", status: 400 });
  assertEquals(createError({ message: "Database error creating new user" }), { error: "closed", status: 403 });
  assertEquals(createError({ message: "boom" }), { error: "internal", status: 500 });
});

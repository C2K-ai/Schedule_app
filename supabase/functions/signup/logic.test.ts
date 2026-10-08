import { assertEquals } from "jsr:@std/assert@1";
import { createError, parseSignup } from "./logic.ts";

Deno.test("가입 신청 검사", () => {
  assertEquals(parseSignup({ email: "  Friend@Naver.com ", password: "secret1" }), { email: "friend@naver.com", password: "secret1" });
  assertEquals(parseSignup({ email: "nope", password: "secret1" }), { error: "bad_email" });
  assertEquals(parseSignup({ email: "a@b.co", password: "12345" }), { error: "weak_password" });
  assertEquals(parseSignup({ email: "a@b.co", password: "x".repeat(73) }), { error: "long_password" });
  assertEquals(parseSignup(null), { error: "bad_body" });
  assertEquals(parseSignup({ email: 3, password: "secret1" }), { error: "bad_email" });
});

Deno.test("계정 만들기 오류 분류", () => {
  assertEquals(createError({ code: "email_exists", message: "A user with this email address has already been registered" }), { error: "exists", status: 409 });
  assertEquals(createError({ code: "weak_password", message: "Password should be at least 6 characters." }), { error: "weak_password", status: 400 });
  assertEquals(createError({ message: "Database error creating new user" }), { error: "closed", status: 403 });
  assertEquals(createError({ message: "boom" }), { error: "internal", status: 500 });
});

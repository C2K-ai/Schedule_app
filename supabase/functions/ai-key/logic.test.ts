// deno test ai-key/logic.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { cleanKey, testError } from "./logic.ts";

const KEY = `sk-ant-api03-${"A1b2_C3d-".repeat(10)}AAAA`;

Deno.test("키 모양 — 앞뒤 공백·줄바꿈은 지우고, 모양이 다르면 null", () => {
  assertEquals(cleanKey(`  ${KEY}\n`), KEY);
  assertEquals(cleanKey(KEY), KEY);
  for (const bad of ["", "sk-ant-짧음", "sk-proj-abcdefghijklmnopqrstuvwxyz", `sk-ant-api03-${"a".repeat(20)} 띄어쓰기`, `${KEY}"`, null, 3, {}]) {
    assertEquals(cleanKey(bad), null, String(bad));
  }
});

Deno.test("시험 실패 이유 → 오류 이름", () => {
  assertEquals(testError(401, "invalid x-api-key"), "key_rejected");
  assertEquals(testError(403, "permission"), "key_no_permission");
  assertEquals(testError(400, "Your credit balance is too low to access the Anthropic API."), "no_credit");
  assertEquals(testError(400, "max_tokens: bad"), "key_test_failed");
  assertEquals(testError(429, "rate"), "rate_limited");
  assertEquals(testError(529, "overloaded"), "rate_limited");
  assertEquals(testError(undefined, "fetch failed"), "key_test_failed");
});

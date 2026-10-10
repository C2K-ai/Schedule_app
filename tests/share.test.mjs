// 공유받은 글 정리. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { sharedText } from "../src/lib/share.ts";

test("제목·본문·주소를 한 줄로, 겹치는 건 한 번만", () => {
  assert.equal(sharedText(new URLSearchParams("text=내일 저녁 7시\n강남역")), "내일 저녁 7시 강남역");
  assert.equal(sharedText(new URLSearchParams("title=모임&text=토요일 2시 모임 https://x.y&url=https://x.y")), "모임 / 토요일 2시 모임 https://x.y");
  assert.equal(sharedText(new URLSearchParams("source=pwa")), "");
  assert.equal(sharedText(new URLSearchParams(`text=${"가".repeat(3000)}`)).length, 2000);
});

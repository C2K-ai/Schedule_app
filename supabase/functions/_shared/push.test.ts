// Edge Function 공용 모듈 테스트 — 실제 Deno 런타임에서 web-push 암호화·발송과 버튼 토큰을 확인한다.
//   cd supabase/functions && deno test --allow-net --allow-env _shared/push.test.ts
import webpush from "npm:web-push@3.6.7";

const vapid = webpush.generateVAPIDKeys();
Deno.env.set("VAPID_PUBLIC_KEY", vapid.publicKey);
Deno.env.set("VAPID_PRIVATE_KEY", vapid.privateKey);
Deno.env.set("VAPID_SUBJECT", "mailto:test@example.com");
Deno.env.set("ACTION_SECRET", "test-secret-그대로-써도-되는-값");
Deno.env.set("SUPABASE_URL", "http://127.0.0.1:1");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "x");

const { describe, sendToUser, signAction, verifyAction } = await import("./push.ts");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

Deno.test("버튼 토큰: 서명 → 검증, 위조·만료는 거절", async () => {
  const id = "11111111-2222-4333-8444-555555555555";
  const tok = await signAction(id);
  assert((await verifyAction(tok)) === id, "정상 토큰 검증 실패");
  const [a, b, sig] = tok.split(".");
  assert((await verifyAction(`${a}.${b}.${sig.slice(0, -2)}xx`)) === null, "위조 서명이 통과됨");
  assert((await verifyAction(`${a.replace("1", "9")}.${b}.${sig}`)) === null, "다른 일정 id 가 통과됨");
  const expired = await signAction(id, -10);
  assert((await verifyAction(expired)) === null, "만료 토큰이 통과됨");
});

Deno.test("알림 문구: 시간대·경과 시간", () => {
  const start = Date.parse("2026-10-05T14:30:00Z");
  const t = { title: "독일어", starts_at: "2026-10-05T14:30:00Z", ends_at: "2026-10-05T15:00:00Z" };
  const s = describe("start", 0, t, start, "Asia/Seoul");
  assert(s.title === "▶ 지금 시작: 독일어" && s.body.startsWith("23:30–00:00"), `start 문구 ${JSON.stringify(s)}`);
  const o = describe("overdue", 1, t, start + 7 * 60000, "Asia/Seoul");
  assert(o.title.includes("7분 지남"), `overdue 문구 ${o.title}`);
  const b = describe("before", 10, t, start - 10 * 60000, "Asia/Seoul");
  assert(b.title.startsWith("⏰ 10분 뒤 시작"), `before 문구 ${b.title}`);
});

Deno.test("web-push: Deno 에서 만든 암호문을 브라우저처럼 복호화 (RFC 8291)", async () => {
  // 브라우저 구독 흉내 — P-256 키쌍 + 16바이트 auth
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const message = JSON.stringify({ title: "▶ 지금 시작: 독일어", kind: "start" });

  const req = webpush.generateRequestDetails(
    { endpoint: "https://push.example.com/abc", keys: { p256dh: b64url(uaPub), auth: b64url(authSecret) } },
    message,
    { TTL: 600, urgency: "high", vapidDetails: { subject: "mailto:test@example.com", publicKey: vapid.publicKey, privateKey: vapid.privateKey } },
  );
  const h = req.headers as Record<string, string>;
  assert(h["Content-Encoding"] === "aes128gcm", `content-encoding ${h["Content-Encoding"]}`);
  assert(h["Urgency"] === "high" && String(h["TTL"]) === "600", "urgency/TTL 헤더");
  assert(/^vapid t=.+, k=.+/.test(h["Authorization"] ?? ""), `VAPID 헤더 ${h["Authorization"]}`);

  // ── 복호화 ──
  const body = new Uint8Array(req.body as ArrayBuffer);
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPub = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  type Bytes = Uint8Array<ArrayBuffer>;
  const hkdf = async (saltB: Bytes, ikm: Bytes, info: Bytes, bytes: number) => {
    const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: saltB, info }, k, bytes * 8));
  };
  const enc = new TextEncoder();
  const keyInfo = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPub, ...asPub]);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, cipher));
  let end = plain.length - 1;
  while (end > 0 && plain[end] === 0) end--;
  assert(plain[end] === 2, "마지막 레코드 구분자(0x02)");
  const text = new TextDecoder().decode(plain.slice(0, end));
  assert(text === message, `복호화 결과가 다름: ${text}`);
});

Deno.test("sendToUser: 만료된 구독(410)은 지우고, 오류는 집계", async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const deleted: string[] = [];
  const fakeDb = {
    from: () => ({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: [{ id: "dead", endpoint: "https://127.0.0.1:9/gone", p256dh: b64url(raw), auth: b64url(new Uint8Array(16)) }],
            error: null,
          }),
      }),
      delete: () => ({ eq: (_c: string, id: string) => (deleted.push(id), Promise.resolve({})) }),
    }),
  };
  // 9번 포트는 닫혀 있다 → 네트워크 오류는 failed 로 집계되고 구독은 지우지 않는다
  const r = await sendToUser(fakeDb as never, "u1", { title: "t", body: "b", tag: "x", kind: "start" });
  assert(r.failed === 1 && r.sent === 0 && deleted.length === 0, `결과 ${JSON.stringify(r)}`);
});
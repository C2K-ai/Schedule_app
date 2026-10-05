// Web Push 용 VAPID 키 + 서버 비밀값 생성 (의존성 없음)
//   node scripts/gen-vapid.mjs
// 출력된 값을 .env.local(앱)과 Supabase Edge Function secrets(서버)에 나눠 넣는다.
import { generateKeyPairSync, randomBytes } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });

const b64url = (buf) => Buffer.from(buf).toString("base64url");
// 공개키 = 비압축 점 0x04 || X || Y
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);

const vapidPublic = b64url(raw);
const vapidPrivate = priv.d;
const cronSecret = randomBytes(24).toString("base64url");
const actionSecret = randomBytes(32).toString("base64url");

console.log(`
# ── 1) 앱: .env.local 에 추가 ─────────────────────────────
NEXT_PUBLIC_VAPID_PUBLIC_KEY=${vapidPublic}

# ── 2) 서버: 아래 명령 한 줄로 Edge Function 비밀값 등록 ───────
npx supabase secrets set VAPID_PUBLIC_KEY=${vapidPublic} VAPID_PRIVATE_KEY=${vapidPrivate} VAPID_SUBJECT=mailto:you@example.com CRON_SECRET=${cronSecret} ACTION_SECRET=${actionSecret}

# ── 3) DB: SQL Editor 에서 실행 (pg_cron 이 함수를 부를 때 쓰는 값) ──
select vault.create_secret('https://<프로젝트ID>.supabase.co', 'must_project_url');
select vault.create_secret('${cronSecret}', 'must_cron_secret');
`);

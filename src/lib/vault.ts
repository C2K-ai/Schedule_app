// 드라이브 파일 비밀번호 잠금 — 브라우저 안에서 암호화해서 올린다(서버·운영자도 내용을 못 봄).
//   비밀번호 → PBKDF2-SHA256(60만 번) → AES-256-GCM. 비밀번호를 잊으면 누구도 열 수 없다.
//   파일 모양: "DRV1"(4) + 반복 횟수(4, big-endian) + salt(16) + iv(12) + 암호문(+태그 16).
//   앞의 36바이트(머리)는 AES-GCM 의 추가 인증 데이터 — 머리를 바꿔치기하면 풀리지 않는다.

const MAGIC = [0x44, 0x52, 0x56, 0x31]; // "DRV1"
export const ITERATIONS = 600_000;
export const HEADER = 36;
/** 암호화하면 늘어나는 크기(머리 + GCM 태그) */
export const OVERHEAD = HEADER + 16;
export const MIN_PASSWORD = 6;

export class WrongPassword extends Error {
  constructor() {
    super("비밀번호가 틀렸어요.");
  }
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function isLocked(bytes: Uint8Array): boolean {
  return bytes.length >= OVERHEAD && MAGIC.every((b, i) => bytes[i] === b);
}

export async function lockBytes(plain: ArrayBuffer | Uint8Array, password: string, iterations = ITERATIONS): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const head = new Uint8Array(HEADER);
  head.set(MAGIC, 0);
  new DataView(head.buffer).setUint32(4, iterations, false);
  head.set(salt, 8);
  head.set(iv, 24);
  const key = await deriveKey(password, salt, iterations);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: head }, key, plain as BufferSource));
  const out = new Uint8Array(HEADER + ct.length);
  out.set(head, 0);
  out.set(ct, HEADER);
  return out;
}

export async function unlockBytes(data: ArrayBuffer | Uint8Array, password: string): Promise<ArrayBuffer> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!isLocked(bytes)) throw new Error("잠긴 파일 형식이 아니에요.");
  const head = bytes.subarray(0, HEADER);
  const iterations = new DataView(head.buffer, head.byteOffset, HEADER).getUint32(4, false);
  if (iterations < 1000 || iterations > 10_000_000) throw new Error("잠긴 파일 형식이 아니에요.");
  const key = await deriveKey(password, head.slice(8, 24), iterations);
  try {
    return await crypto.subtle.decrypt({ name: "AES-GCM", iv: head.slice(24, 36), additionalData: head.slice() }, key, bytes.subarray(HEADER) as BufferSource);
  } catch {
    throw new WrongPassword();
  }
}

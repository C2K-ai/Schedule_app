// 일기 암호화 — 브라우저(WebCrypto)와 Node 테스트에서 같이 돈다. import 없음.
export const ITERATIONS = 600_000;
export const MIN_ITERATIONS = 600_000;
export const MAX_ITERATIONS = 5_000_000;
export const MAX_PLAIN_BYTES = 65_536;
const MIN_BUCKET = 512;

export class WrongKey extends Error {
  constructor() {
    super("wrong_key");
  }
}
export class TooLong extends Error {
  constructor() {
    super("too_long");
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64u(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new WrongKey();
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
export const newKid = () => b64u(rand(16));
export const newSalt = () => b64u(rand(16));

/** WebCrypto 가 있나(https·localhost 에서만). IndexedDB 문제는 저장소 쪽에서 알려 준다 */
export function supported(): boolean {
  return typeof crypto !== "undefined" && Boolean(crypto?.subtle);
}

export function generateDek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]) as Promise<CryptoKey>;
}

export async function deriveKek(password: string, salt: string, iterations: number): Promise<CryptoKey> {
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new WrongKey();
  const base = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: unb64u(salt) as BufferSource, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function gcm(key: CryptoKey, plain: Uint8Array, aad: string): Promise<string> {
  const iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, plain as BufferSource));
  return `${b64u(iv)}.${b64u(ct)}`;
}
async function ungcm(key: CryptoKey, ivCt: string, aad: string): Promise<Uint8Array> {
  const [iv, ct, extra] = ivCt.split(".");
  if (!iv || !ct || extra !== undefined) throw new WrongKey();
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) as BufferSource, additionalData: enc.encode(aad) }, key, unb64u(ct) as BufferSource),
    );
  } catch {
    throw new WrongKey();
  }
}

export const wrapAad = (uid: string, kid: string, salt: string, iterations: number) =>
  `DREAM-diary-wrap-v1|${uid}|${kid}|${salt}|${iterations}`;
export const ringAad = (uid: string, kid: string, byKid: string) => `DREAM-diary-ring-v1|${uid}|${kid}|${byKid}`;
export const entryAad = (uid: string, id: string, day: string, kid: string) => `DREAM-diary-entry-v1|${uid}|${id}|${day}|${kid}`;

export async function wrapKey(dek: CryptoKey, by: CryptoKey, aad: string): Promise<string> {
  return gcm(by, new Uint8Array(await crypto.subtle.exportKey("raw", dek)), aad);
}
export async function unwrapKey(w: string, by: CryptoKey, aad: string): Promise<CryptoKey> {
  const raw = await ungcm(by, w, aad);
  if (raw.length !== 32) throw new WrongKey();
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", true, ["encrypt", "decrypt"]);
}

export interface Plain {
  body: string;
  /** 1~5, 없으면 null */
  mood: number | null;
}

/** {b, m, p} — m 은 0(없음)~5 한 자리, p 는 공백으로 UTF-8 길이를 512·1K·2K…64K 로 맞춘다 */
export function pad(p: Plain): Uint8Array {
  const m = p.mood && p.mood >= 1 && p.mood <= 5 ? Math.round(p.mood) : 0;
  const bare = enc.encode(JSON.stringify({ b: p.body, m, p: "" })).length;
  if (bare > MAX_PLAIN_BYTES) throw new TooLong();
  let size = MIN_BUCKET;
  while (size < bare) size *= 2;
  const out = enc.encode(JSON.stringify({ b: p.body, m, p: " ".repeat(size - bare) }));
  return out;
}
export function unpad(bytes: Uint8Array): Plain {
  const o = JSON.parse(dec.decode(bytes)) as { b?: unknown; m?: unknown };
  if (typeof o.b !== "string" || typeof o.m !== "number") throw new WrongKey();
  return { body: o.b, mood: o.m >= 1 && o.m <= 5 ? o.m : null };
}
export function plainBytes(p: Plain): number {
  return enc.encode(JSON.stringify({ b: p.body, m: 0, p: "" })).length;
}

export const SEALED_RE = /^v1\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+)$/;
export function sealedKid(sealed: string): string | null {
  return SEALED_RE.exec(sealed)?.[1] ?? null;
}

export async function seal(p: Plain, key: CryptoKey, kid: string, uid: string, id: string, day: string): Promise<string> {
  return `v1.${kid}.${await gcm(key, pad(p), entryAad(uid, id, day, kid))}`;
}
export async function open(sealed: string, keys: Record<string, CryptoKey>, uid: string, id: string, day: string): Promise<Plain> {
  const m = SEALED_RE.exec(sealed);
  if (!m) throw new WrongKey();
  const key = keys[m[1]];
  if (!key) throw new WrongKey();
  return unpad(await ungcm(key, m[2], entryAad(uid, id, day, m[1])));
}

/** 약한 비밀번호 — 10자 미만이거나 글자 종류가 하나뿐 */
export function weakPassword(pw: string): boolean {
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  return pw.length < 10 || kinds < 2;
}

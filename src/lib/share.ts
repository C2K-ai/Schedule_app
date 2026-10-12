// 다른 앱(카톡 등)에서 '공유 → DREAM' 으로 받은 글. manifest 의 share_target 이 ?title=&text=&url= 로 넘겨준다.

/** 받은 글을 Write 창으로 넘길 때 쓰는 sessionStorage 키 */
export const SHARED_KEY = "must:shared-text";

/** 서비스 워커가 '공유 → DREAM'(POST)으로 받아 둔 사진·글을 꺼낸다(꺼내면 지움) — public/sw.js 의 SHARE 캐시 */
export async function takeSharedFromWorker(base: string): Promise<{ text: string; image: File | null }> {
  if (typeof caches === "undefined") return { text: "", image: null };
  const cache = await caches.open("must-share");
  const [t, img] = await Promise.all([cache.match(`${base}/__shared/text`), cache.match(`${base}/__shared/image`)]);
  await Promise.all([cache.delete(`${base}/__shared/text`), cache.delete(`${base}/__shared/image`)]);
  const fields = t ? ((await t.json().catch(() => ({}))) as Record<string, string>) : {};
  const blob = img ? await img.blob() : null;
  return {
    text: sharedText(new URLSearchParams(fields)),
    image: blob && blob.size ? new File([blob], "shared", { type: blob.type || "image/jpeg" }) : null,
  };
}

/** 제목·본문·주소를 한 줄로 — 겹치는 건 한 번만(카톡은 보통 본문에 다 들어 있다) */
export function sharedText(q: URLSearchParams): string {
  const parts: string[] = [];
  for (const k of ["title", "text", "url"]) {
    const v = (q.get(k) ?? "").replace(/\s+/g, " ").trim();
    if (v && !parts.some((p) => p.includes(v))) parts.push(v);
  }
  return parts.join(" / ").slice(0, 2000);
}

// 다른 앱(카톡 등)에서 '공유 → DREAM' 으로 받은 글. manifest 의 share_target 이 ?title=&text=&url= 로 넘겨준다.

/** 받은 글을 Write 창으로 넘길 때 쓰는 sessionStorage 키 */
export const SHARED_KEY = "must:shared-text";

/** 제목·본문·주소를 한 줄로 — 겹치는 건 한 번만(카톡은 보통 본문에 다 들어 있다) */
export function sharedText(q: URLSearchParams): string {
  const parts: string[] = [];
  for (const k of ["title", "text", "url"]) {
    const v = (q.get(k) ?? "").replace(/\s+/g, " ").trim();
    if (v && !parts.some((p) => p.includes(v))) parts.push(v);
  }
  return parts.join(" / ").slice(0, 2000);
}

import type { MetadataRoute } from "next";
import { withBase } from "@/lib/base";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: withBase("/"),
    name: "DREAM",
    short_name: "DREAM",
    description: "미시작 일정 경고·정각 알림·카운트다운·뽀모도로가 한 화면에 있는 습관/일정 플래너",
    lang: "ko",
    start_url: withBase("/?source=pwa"),
    scope: withBase("/"),
    display: "standalone",
    // PC 에 설치한 앱은 크롬 제목 줄 대신 앱이 그 자리를 그린다(확장·다운로드 아이콘이 사라지고 창 버튼·⋮ 만 남음)
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "any",
    background_color: "#0b0920",
    theme_color: "#0b0920",
    categories: ["productivity", "lifestyle"],
    // 카톡·갤러리에서 '공유 → DREAM' — 글과 사진(캡처)을 받는다. POST 라서 서비스 워커(public/sw.js)가 받아 잠깐 캐시에 두고
    // 앱을 ?shared=1 로 연다 → ReminderEngine 이 'Write' 창에 글·사진을 채워서 연다.
    // 안드로이드에서 홈 화면에 설치한 앱만 공유 목록에 뜬다(아이폰 Safari 는 미지원). 예전 GET(?text=) 도 그대로 받는다.
    share_target: {
      action: withBase("/share-target"),
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url", files: [{ name: "image", accept: ["image/*"] }] },
    },
    icons: [
      { src: withBase("/icons/icon-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: withBase("/icons/icon-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: withBase("/icons/maskable-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "말로 일정 추가", short_name: "말로 추가", url: withBase("/?action=voice"), icons: [{ src: withBase("/icons/icon-192.png"), sizes: "192x192" }] },
      { name: "새 일정", short_name: "추가", url: withBase("/?action=new"), icons: [{ src: withBase("/icons/icon-192.png"), sizes: "192x192" }] },
      { name: "집중 시작", short_name: "집중", url: withBase("/?action=focus"), icons: [{ src: withBase("/icons/icon-192.png"), sizes: "192x192" }] },
    ],
  };
}

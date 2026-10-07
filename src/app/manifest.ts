import type { MetadataRoute } from "next";
import { withBase } from "@/lib/base";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: withBase("/"),
    name: "DREAM — 미루지 못하는 플래너",
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

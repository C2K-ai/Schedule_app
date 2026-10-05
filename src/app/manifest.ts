import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "MUST — 미루지 못하는 플래너",
    short_name: "MUST",
    description: "미시작 일정 경고·정각 알림·카운트다운·뽀모도로가 한 화면에 있는 습관/일정 플래너",
    lang: "ko",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0a0b0f",
    theme_color: "#0a0b0f",
    categories: ["productivity", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "새 일정", short_name: "추가", url: "/?action=new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "집중 시작", short_name: "집중", url: "/?action=focus", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}

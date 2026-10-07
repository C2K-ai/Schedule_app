import type { Metadata, Viewport } from "next";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";
import { withBase } from "@/lib/base";

export const metadata: Metadata = {
  title: "DREAM — 미루지 못하는 플래너",
  description: "미시작 일정은 빨갛게, 미루려면 사유를. 알림·카운트다운·뽀모도로가 한 화면에 있는 습관/일정 플래너.",
  applicationName: "DREAM",
  appleWebApp: { capable: true, title: "DREAM", statusBarStyle: "black-translucent" },
  icons: { apple: withBase("/icons/apple-touch-icon.png") },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0b0920" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0920" },
  ],
};

// 첫 페인트 전에 테마를 정해 깜빡임을 막는다
const themeScript = `(()=>{var h=document.documentElement;try{var t=localStorage.getItem('must:theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);h.dataset.theme=d?'dark':'light';h.dataset.palette=localStorage.getItem('must:palette')||'dusk'}catch(e){h.dataset.theme='dark';h.dataset.palette='dusk'}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" data-theme="dark" data-palette="dusk" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        {/* PC 설치 앱의 제목 줄(창 제목 줄 숨김 모드에서만 보임 — globals.css .app-titlebar) */}
        <div className="app-titlebar" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element -- 정적 내보내기라 next/image 최적화를 못 쓴다 */}
          <img src={withBase("/icons/icon-192.png")} alt="" width={16} height={16} />
          <span>DREAM</span>
        </div>
        {children}
      </body>
    </html>
  );
}

"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { isIOS, isStandalone } from "@/lib/notify";

/** 카카오톡·네이버·인스타 같은 앱 안 브라우저 — 여기선 앱 설치·알림이 안 된다 */
export const IN_APP = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|; wv\)/i;

/** 앱 안 브라우저에서 진짜 브라우저(Chrome)로 이 주소를 연다 */
function openInBrowser() {
  const url = location.href;
  if (/KAKAOTALK/i.test(navigator.userAgent)) location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
  else if (/Android/i.test(navigator.userAgent))
    location.href = `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;package=com.android.chrome;end`;
}

/** 앱 안 브라우저로 열었으면 어느 탭에서든 맨 위에 — 'Chrome(Safari)에서 열어야 설치돼요' */
export function InAppNotice() {
  const [show] = useState(() => typeof navigator !== "undefined" && IN_APP.test(navigator.userAgent) && !isStandalone());
  const [ios] = useState(() => isIOS());
  if (!show) return null;
  return (
    <div className="fade-up flex items-center gap-3 rounded-2xl border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-[13px]">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">카톡 안에서는 앱 설치가 안 돼요</p>
        <p className="mt-0.5 text-muted">
          {ios
            ? "오른쪽 아래(또는 위) 메뉴 → ‘Safari로 열기’ → 공유 버튼 → ‘홈 화면에 추가’."
            : "Chrome 으로 연 뒤 ⋮ → ‘앱 설치’."}
        </p>
      </div>
      {!ios && (
        <button onClick={openInBrowser} className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-accent-fg">
          <ExternalLink size={14} /> Chrome으로 열기
        </button>
      )}
    </div>
  );
}

"use client";

import { Sunrise, X } from "lucide-react";
import { useEffect, useState } from "react";
import { buildBriefing } from "@/lib/briefing";
import { showSystemNotification } from "@/lib/notify";
import { briefingTime, isPhone } from "@/lib/push";
import { dayKey } from "@/lib/time";
import { usePlanner } from "./PlannerProvider";

const SESSION_KEY = "must:briefed";

const CARD_KEY = "must:briefing-card";
const CARD_EVENT = "must:briefing";

/** 앱을 켤 때(노트북 부팅 뒤 자동 실행 포함) 한 번 — 시스템 알림을 띄우고, 작업 탭 카드에 문구를 넘긴다. 늘 붙어 있는 관리자 */
export function BriefingEngine() {
  const { tasks, settings, session, snap } = usePlanner();
  const ready = !session.userId || snap.status.lastSyncAt !== null || snap.status.mode === "local";

  useEffect(() => {
    if (!settings.launchBriefing || !ready) return;
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      return;
    }
    const b = buildBriefing(tasks, Date.now(), settings.graceMin);
    try {
      sessionStorage.setItem(CARD_KEY, b.line);
    } catch {
      /* 카드는 못 보여도 알림은 띄운다 */
    }
    window.dispatchEvent(new Event(CARD_EVENT));
    // 폰은 서버가 아침에 브리핑을 보내므로 앱을 열 때 또 띄우지 않는다(위 카드만). 띄울 때도 서버 브리핑과 같은 자리(그날 tag) — 겹치지 않게
    if (isPhone() && briefingTime()) return;
    void showSystemNotification({
      title: b.title,
      body: b.body,
      tag: `must-briefing-${dayKey(new Date())}`,
      kind: "before",
      vibration: "short",
      renotify: false,
    });
  }, [ready, settings.launchBriefing, settings.graceMin, tasks]);

  return null;
}

const readCard = () => {
  try {
    return sessionStorage.getItem(CARD_KEY);
  } catch {
    return null;
  }
};

/** 작업 탭 맨 위 한 줄 — 닫으면 이번 실행 동안 다시 안 나온다 */
export function BriefingCard() {
  const [body, setBody] = useState<string | null>(readCard);
  useEffect(() => {
    const on = () => setBody(readCard());
    window.addEventListener(CARD_EVENT, on);
    return () => window.removeEventListener(CARD_EVENT, on);
  }, []);
  if (!body) return null;
  return (
    <div className="fade-up flex items-center gap-3 rounded-2xl bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] px-4 py-2.5">
      <Sunrise size={18} className="shrink-0 text-accent-text" />
      <p className="min-w-0 flex-1 text-sm">{body}</p>
      <button
        aria-label="닫기"
        onClick={() => {
          try {
            sessionStorage.removeItem(CARD_KEY);
          } catch {
            /* 무시 */
          }
          setBody(null);
        }}
        className="shrink-0 text-muted hover:text-fg"
      >
        <X size={16} />
      </button>
    </div>
  );
}

"use client";

import { Sunrise, X } from "lucide-react";
import { useEffect, useState } from "react";
import { showSystemNotification } from "@/lib/notify";
import { checkinQueue, enforcementQueue, isTimed, tasksOnDay } from "@/lib/planner";
import { fmtTime, startOfDay } from "@/lib/time";
import type { Task } from "@/lib/types";
import { usePlanner } from "./PlannerProvider";

const SESSION_KEY = "must:briefed";

export interface Briefing {
  title: string;
  body: string;
  open: number;
  first: Task | null;
  overdue: number;
}

/** 오늘 브리핑 문구 — "오늘 일정 n개 · 첫 일정 · 미시작 n건" */
export function buildBriefing(tasks: Task[], now: number, graceMin: number): Briefing {
  const today = tasksOnDay(tasks, startOfDay(new Date(now)));
  const open = today.filter((t) => t.status === "planned" || t.status === "in_progress");
  const first = open.filter((t) => isTimed(t) && Date.parse(t.starts_at) >= now - graceMin * 60_000).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null;
  const overdue = enforcementQueue(tasks, now, graceMin).length;
  const unchecked = checkinQueue(tasks, now).length;
  const parts = [
    open.length ? `오늘 할 일 ${open.length}개` : "오늘 남은 할 일 없음",
    first ? `다음 ${fmtTime(first.starts_at)} ${first.title}` : null,
    overdue ? `미시작 ${overdue}건` : null,
    unchecked ? `했는지 확인할 일정 ${unchecked}건` : null,
  ].filter(Boolean);
  const hour = new Date(now).getHours();
  const hello = hour < 11 ? "좋은 아침이에요" : hour < 17 ? "오늘 브리핑" : "저녁 브리핑";
  return { title: `☀ ${hello}`, body: parts.join(" · "), open: open.length, first, overdue };
}

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
      sessionStorage.setItem(CARD_KEY, b.body);
    } catch {
      /* 카드는 못 보여도 알림은 띄운다 */
    }
    window.dispatchEvent(new Event(CARD_EVENT));
    void showSystemNotification({ title: b.title, body: b.body, tag: "must-briefing", kind: "before", vibration: "short" });
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

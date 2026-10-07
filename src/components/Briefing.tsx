"use client";

import { Sunrise, X } from "lucide-react";
import { useEffect, useState } from "react";
import { showSystemNotification } from "@/lib/notify";
import { enforcementQueue, isTimed, tasksOnDay } from "@/lib/planner";
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
  const parts = [
    open.length ? `오늘 할 일 ${open.length}개` : "오늘 남은 할 일 없음",
    first ? `다음 ${fmtTime(first.starts_at)} ${first.title}` : null,
    overdue ? `미시작 ${overdue}건` : null,
  ].filter(Boolean);
  const hour = new Date(now).getHours();
  const hello = hour < 11 ? "좋은 아침이에요" : hour < 17 ? "오늘 브리핑" : "저녁 브리핑";
  return { title: `☀ ${hello}`, body: parts.join(" · "), open: open.length, first, overdue };
}

/** 앱을 켤 때(노트북 부팅 뒤 자동 실행 포함) 한 번 — 시스템 알림 + 화면 위 카드 */
export function BriefingCard() {
  const { tasks, settings, session, snap } = usePlanner();
  const [brief, setBrief] = useState<Briefing | null>(null);
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
    // 서버에서 받아 온 뒤 한 번만 — 외부(세션 저장소) 상태를 읽어 결정하는 초기화
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrief(b);
    void showSystemNotification({ title: b.title, body: b.body, tag: "must-briefing", kind: "before", vibration: "short" });
  }, [ready, settings.launchBriefing, settings.graceMin, tasks]);

  if (!brief) return null;
  return (
    <div className="fade-up flex items-start gap-3 rounded-2xl border border-accent/40 bg-[color-mix(in_oklab,var(--accent)_10%,var(--surface))] px-4 py-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg">
        <Sunrise size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{brief.title.replace("☀ ", "")}</p>
        <p className="mt-0.5 text-sm text-muted">{brief.body}</p>
      </div>
      <button aria-label="닫기" onClick={() => setBrief(null)} className="text-muted hover:text-fg">
        <X size={18} />
      </button>
    </div>
  );
}

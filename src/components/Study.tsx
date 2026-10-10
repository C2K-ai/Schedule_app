"use client";

import { Square } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { activeStudy, liveStudy, stopStudy, studyDayStart, studySeconds, studyStartedHere } from "@/lib/planner";
import { DAY, fmtTime } from "@/lib/time";
import { COLOR_HEX } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { usePlanner } from "./PlannerProvider";

/** 초 → "1:02:03" (열품타처럼 시·분·초 다 보이게) */
export function fmtHMS(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** 초 → "3시간 12분" */
export function fmtHM(sec: number): string {
  const m = Math.round(sec / 60);
  const h = Math.floor(m / 60);
  if (h === 0) return `${m}분`;
  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
}

const HIDDEN_KEY = "must:study-hidden";
const AWAY_GRACE_MS = 60_000;

/**
 * 보이지 않는 관리자 —
 *  · 재는 동안 탭 제목에 시간 표시
 *  · '자리 비우면 멈춤'(설정, 기본 꺼짐): 켜면 앱이 1분 넘게 화면 밖일 때 떠난 시각에 멈춘다. 끄면 나가 있어도 계속 잰다.
 *    폰에서 앱이 꺼졌다 다시 열려도 알 수 있게 떠난 시각을 저장해 둔다.
 */
export function StudyEngine() {
  const { snap, store, settings, toast } = usePlanner();
  const active = activeStudy(snap.db);
  const subject = active?.subject_id ? snap.db.subjects[active.subject_id] : null;
  const now = useNow(1000);
  const baseTitle = useRef<string | null>(null);

  useEffect(() => {
    baseTitle.current ??= document.title;
    if (!active) {
      document.title = baseTitle.current;
      return;
    }
    const sec = (now - Date.parse(active.started_at)) / 1000;
    document.title = `⏱ ${fmtHMS(sec)} · ${subject?.name ?? "공부"}`;
  }, [active, subject, now]);

  useEffect(() => {
    if (!settings.studyAwayStop) return;
    const check = () => {
      let rec: { id: string; at: number } | null = null;
      try {
        rec = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "null");
      } catch {
        rec = null;
      }
      const raw = activeStudy(store.db);
      // 다른 기기에서 재는 공부는 이 기기 화면이 꺼져도 건드리지 않는다
      const cur = raw && studyStartedHere(raw.id) ? raw : null;
      if (document.visibilityState === "hidden") {
        if (cur) {
          try {
            localStorage.setItem(HIDDEN_KEY, JSON.stringify({ id: cur.id, at: Date.now() }));
          } catch {
            /* 기록 못 하면 자동 정지 없이 계속 잰다 */
          }
        }
        return;
      }
      try {
        localStorage.removeItem(HIDDEN_KEY);
      } catch {
        /* 무시 */
      }
      if (rec && cur && rec.id === cur.id && Date.now() - rec.at > AWAY_GRACE_MS) {
        stopStudy(store, new Date(rec.at));
        toast({ text: `자리를 비워서 ${fmtTime(new Date(rec.at))}에 타이머를 멈췄어요`, tone: "danger", ttl: 8000 });
      }
    };
    check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, [settings.studyAwayStop, store, toast]);

  return null;
}

/** 다른 탭에 있을 때 위쪽 막대 아래에 붙는 '공부 중' 줄 */
export function StudyDock({ onOpen, hidden }: { onOpen: () => void; hidden?: boolean }) {
  const { snap, store, settings } = usePlanner();
  const active = activeStudy(snap.db);
  const now = useNow(1000);
  const sessions = useMemo(() => liveStudy(snap.db), [snap.db]);
  if (!active || hidden) return null;
  const subject = active.subject_id ? snap.db.subjects[active.subject_id] : null;
  const from = studyDayStart(new Date(now), settings.dayStartHour).getTime();
  const today = studySeconds(sessions, from, from + DAY, now);
  return (
    <div className="mx-auto flex h-11 max-w-[1200px] items-center gap-3 border-t border-line px-4 md:px-8">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="size-2.5 shrink-0 animate-pulse rounded-full" style={{ background: subject ? COLOR_HEX[subject.color] : "var(--accent)" }} />
        <span className="truncate text-sm font-semibold">{subject?.name ?? "공부"} 중</span>
        <span className="ml-auto font-mono text-sm font-bold tabular-nums">{fmtHMS(today)}</span>
      </button>
      <button
        onClick={() => stopStudy(store)}
        aria-label="타이머 멈추기"
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg hover:bg-surface-3"
      >
        <Square size={13} fill="currentColor" />
      </button>
    </div>
  );
}

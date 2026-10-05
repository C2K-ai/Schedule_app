"use client";

import { CalendarDays, Cloud, CloudOff, Download, NotebookPen, Repeat, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { isStandalone } from "@/lib/notify";
import { cloudEnabled } from "@/lib/supabase";
import { currentTask, dayStats, enforcementQueue, nextTask, tasksOnDay } from "@/lib/planner";
import { fmtCountdown, fmtDate, fmtTime, startOfDay } from "@/lib/time";
import { COLOR_HEX } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { usePlanner } from "./PlannerProvider";
import { cx, IconButton, Logo } from "./ui";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function SyncPill() {
  const { snap, openSheet, session } = usePlanner();
  const s = snap.status;
  let tone = "text-muted";
  let dot = "bg-faint";
  let text = "이 기기에만 저장";
  let Icon = CloudOff;
  if (cloudEnabled && !session.userId) {
    tone = "text-warn";
    dot = "bg-warn";
    text = "로그인하면 동기화";
  }
  if (s.mode === "cloud") {
    Icon = Cloud;
    if (!s.online) {
      dot = "bg-warn";
      tone = "text-warn";
      text = s.pending ? `오프라인 · ${s.pending}건 대기` : "오프라인";
      Icon = CloudOff;
    } else if (s.error) {
      dot = "bg-danger";
      tone = "text-danger";
      text = "동기화 오류";
    } else if (s.pending) {
      dot = "bg-warn animate-pulse";
      tone = "text-warn";
      text = `올리는 중 ${s.pending}`;
    } else if (s.realtime === "live") {
      dot = "bg-ok";
      tone = "text-ok";
      text = "실시간 동기화";
    } else {
      dot = "bg-warn animate-pulse";
      text = "연결 중";
    }
  }
  return (
    <button
      onClick={() => openSheet("settings", "account")}
      title={s.error ?? text}
      className={cx(
        "hidden h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-xs font-semibold sm:inline-flex",
        tone,
      )}
    >
      <span className={cx("size-2 rounded-full", dot)} />
      <Icon size={14} />
      {text}
    </button>
  );
}

function InstallButton() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    if (isStandalone()) return;
    const on = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", on);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);
  if (!evt) return null;
  return (
    <button
      onClick={async () => {
        await evt.prompt();
        await evt.userChoice;
        setEvt(null);
      }}
      className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-bold text-accent-fg"
    >
      <Download size={14} /> 앱 설치
    </button>
  );
}

/** 큰 카드가 화면 밖으로 나가면 헤더 아래에 붙는 한 줄 — 지금 / 다음까지 / 달성률을 항상 보이게 */
function MiniStatus() {
  const { tasks, settings } = usePlanner();
  const now = useNow(1000);
  const cur = currentTask(tasks, now);
  const nx = nextTask(tasks, now);
  const today = tasksOnDay(tasks, startOfDay(new Date(now)));
  const s = dayStats(today, now, settings.graceMin);
  const overdue = enforcementQueue(tasks, now, settings.graceMin).length;
  const late = cur && cur.status === "planned";
  return (
    <div className="fade-up mx-auto flex h-10 max-w-[1400px] items-center gap-3 border-t border-line px-4 text-[13px] md:px-6">
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className={cx("size-2 shrink-0 rounded-full", late ? "animate-pulse bg-danger" : cur ? "bg-accent" : "bg-faint")}
          style={cur && !late ? { background: COLOR_HEX[cur.color] } : undefined}
        />
        <span className={cx("truncate font-semibold", late && "text-danger")}>
          {cur ? (late ? `시작 안 함 · ${cur.title}` : cur.title) : "비어 있는 시간"}
        </span>
      </span>
      {nx && (
        <span className="shrink-0 font-mono text-muted tabular-nums">
          <span className="font-sans">다음 </span>
          {fmtCountdown(Date.parse(nx.starts_at) - now)}
        </span>
      )}
      {overdue > 0 && (
        <span className="shrink-0 rounded-md bg-danger px-1.5 py-0.5 text-[11px] font-bold text-white">미시작 {overdue}</span>
      )}
      <span className="shrink-0 font-mono font-bold tabular-nums">{s.rate}%</span>
    </div>
  );
}

export function Header({ onToday, compact = false }: { onToday: () => void; compact?: boolean }) {
  const { openSheet } = usePlanner();
  const now = useNow(1000);
  return (
    <header className="safe-top sticky top-0 z-30 border-b border-line bg-[color-mix(in_oklab,var(--bg)_82%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 md:h-16 md:px-6">
        <Logo />
        <button
          onClick={onToday}
          className="ml-1 hidden items-baseline gap-2 rounded-lg px-2 py-1 text-sm hover:bg-surface-2 md:flex"
        >
          <span className="font-semibold">{fmtDate(new Date(now))}</span>
          <span className="font-mono text-muted tabular-nums">{fmtTime(new Date(now))}</span>
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <InstallButton />
          <SyncPill />
          <IconButton label="오늘로" onClick={onToday} className="md:hidden">
            <CalendarDays size={20} />
          </IconButton>
          <IconButton label="습관" onClick={() => openSheet("habits")}>
            <Repeat size={20} />
          </IconButton>
          <IconButton label="기록·사유" onClick={() => openSheet("log")}>
            <NotebookPen size={20} />
          </IconButton>
          <IconButton label="설정" onClick={() => openSheet("settings")}>
            <Settings size={20} />
          </IconButton>
        </div>
      </div>
      {compact && <MiniStatus />}
    </header>
  );
}

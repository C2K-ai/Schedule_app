"use client";

import { Cloud, CloudOff, Download, Mic } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { isStandalone } from "@/lib/notify";
import { cloudEnabled } from "@/lib/supabase";
import { currentTask, dayStats, enforcementQueue, nextTask, tasksOnDay } from "@/lib/planner";
import { fmtCountdown, fmtDate, fmtTime, startOfDay } from "@/lib/time";
import { COLOR_HEX } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { usePlanner } from "./PlannerProvider";
import { cx, IconButton } from "./ui";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function syncLook(p: ReturnType<typeof usePlanner>) {
  const s = p.snap.status;
  let tone = "text-muted";
  let dot = "bg-faint";
  let text = "이 기기에만 저장";
  let Icon = CloudOff;
  if (cloudEnabled && !p.session.userId) {
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
  return { tone, dot, text, Icon, error: s.error };
}

/** 동기화 상태 — 넓은 화면은 글자까지, 폰은 점 하나 */
export function SyncPill({ className }: { className?: string }) {
  const p = usePlanner();
  const { tone, dot, text, Icon, error } = syncLook(p);
  return (
    <button
      onClick={() => p.openSheet("settings", "account")}
      title={error ?? text}
      aria-label={text}
      className={cx(
        "inline-flex h-9 items-center gap-2 rounded-xl px-2.5 text-xs font-semibold sm:border sm:border-line sm:bg-surface sm:px-3",
        tone,
        className,
      )}
    >
      <span className={cx("size-2 rounded-full", dot)} />
      <Icon size={14} className="hidden sm:block" />
      <span className="hidden sm:inline">{text}</span>
    </button>
  );
}

export function InstallButton() {
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

/** 큰 상태 카드가 화면 밖으로 나가면 헤더 아래에 붙는 한 줄 — 지금 / 다음까지 / 달성률을 항상 보이게 */
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
    <div className="fade-up mx-auto flex h-10 max-w-[1200px] items-center gap-3 border-t border-line px-4 text-[13px] md:px-8">
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
        <span className="shrink-0 rounded-md bg-danger px-1.5 py-px text-[11px] font-bold text-white">미시작 {overdue}</span>
      )}
      <span className="shrink-0 font-mono font-bold tabular-nums">{s.rate}%</span>
    </div>
  );
}

/** 위쪽 막대 — 탭 이름 · 날짜 · 동기화 · 말로 추가. compact 면 지금/다음/달성률 한 줄을 붙인다 */
export function TopBar({ title, compact = false, children }: { title: string; compact?: boolean; children?: ReactNode }) {
  const { openSheet } = usePlanner();
  const now = useNow(30_000);
  return (
    <header className="safe-top sticky top-0 z-30 border-b border-line bg-[color-mix(in_oklab,var(--bg)_70%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 md:h-16 md:px-8">
        <h1 className="text-xl font-black tracking-tight md:text-2xl">{title}</h1>
        <span className="hidden items-baseline gap-2 text-sm md:flex">
          <span className="font-semibold text-muted">{fmtDate(new Date(now))}</span>
          <span className="font-mono text-faint tabular-nums">{fmtTime(new Date(now))}</span>
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <InstallButton />
          <SyncPill />
          <button
            onClick={() => openSheet("voice")}
            className="hidden h-9 items-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-bold text-accent-fg md:inline-flex"
          >
            <Mic size={14} /> 말로 추가
          </button>
          <IconButton label="말로 일정 추가" onClick={() => openSheet("voice")} className="md:hidden">
            <Mic size={20} />
          </IconButton>
        </div>
      </div>
      {compact && <MiniStatus />}
      {children}
    </header>
  );
}

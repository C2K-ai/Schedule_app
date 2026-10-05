"use client";

import { CalendarDays, Cloud, CloudOff, Download, NotebookPen, Repeat, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { isStandalone } from "@/lib/notify";
import { fmtDate, fmtTime } from "@/lib/time";
import { useNow } from "@/lib/useNow";
import { usePlanner } from "./PlannerProvider";
import { cx, IconButton, Logo } from "./ui";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function SyncPill() {
  const { snap, openSheet } = usePlanner();
  const s = snap.status;
  let tone = "text-muted";
  let dot = "bg-faint";
  let text = "이 기기에만 저장";
  let Icon = CloudOff;
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

export function Header({ onToday }: { onToday: () => void }) {
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
          <span className="font-semibold">{fmtDate(new Date(now || Date.now()))}</span>
          <span className="font-mono text-muted tabular-nums">{fmtTime(new Date(now || Date.now()))}</span>
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
    </header>
  );
}

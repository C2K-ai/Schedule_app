"use client";

import { Cloud, CloudOff, Download, Image as ImageIcon, Maximize, Mic, Minimize, PanelLeftOpen } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { isStandalone } from "@/lib/notify";
import { cloudEnabled } from "@/lib/supabase";
import { currentTask, dayStats, enforcementQueue, nextTask, tasksOnDay } from "@/lib/planner";
import { fmtCountdown, fmtDate, fmtTime, startOfDay } from "@/lib/time";
import { COLOR_HEX } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { useHasBackdrop } from "./Backdrop";
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
  // 위쪽 막대 글자는 짧은 영어로(사용자 요청) — 자세한 건 눌러서 설정 → 계정에서
  let text = "Local only";
  let Icon = CloudOff;
  if (cloudEnabled && !p.session.userId) {
    tone = "text-warn";
    dot = "bg-warn";
    text = "Sign in to sync";
  }
  if (s.mode === "cloud") {
    Icon = Cloud;
    if (!s.online) {
      dot = "bg-warn";
      tone = "text-warn";
      text = s.pending ? `Offline · ${s.pending} pending` : "Offline";
      Icon = CloudOff;
    } else if (s.error) {
      dot = "bg-danger";
      tone = "text-danger";
      text = "Sync error";
    } else if (s.pending) {
      dot = "bg-warn animate-pulse";
      tone = "text-warn";
      text = `Syncing ${s.pending}`;
    } else if (s.realtime === "live") {
      dot = "bg-ok";
      tone = "text-ok";
      text = "Live sync";
    } else {
      dot = "bg-warn animate-pulse";
      text = "Connecting";
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

/**
 * PC 에 설치한 앱은 전체 화면으로 — 브라우저는 클릭·키 입력 없이 전체 화면을 못 켜서, 켠 뒤 처음 누르는 순간 켠다.
 * 한 번 켠 뒤 Esc 로 나오면 그 실행 동안은 다시 켜지 않는다(설정 → 화면·데이터에서 끌 수 있음)
 */
export function AutoFullscreen({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled || !isStandalone() || !document.fullscreenEnabled) return;
    if (!window.matchMedia("(pointer: fine)").matches || window.innerWidth < 768) return; // 폰·태블릿은 그대로
    const go = () => {
      stop();
      if (!document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => {});
    };
    const stop = () => {
      window.removeEventListener("click", go, true);
      window.removeEventListener("keydown", go, true);
    };
    window.addEventListener("click", go, true);
    window.addEventListener("keydown", go, true);
    return stop;
  }, [enabled]);
  return null;
}

/** PC: 전체 화면 켜기/끄기 — 창 위쪽 줄과 구석의 창 버튼까지 다 사라진다(F11 과 같음, Esc 로 나옴).
 *  위쪽 막대의 오른쪽 위 구석(창 버튼 바로 왼쪽)에 붙는다 */
function FullscreenButton() {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  return (
    <IconButton
      label={full ? "전체 화면 끄기" : "전체 화면"}
      className="absolute top-3 right-[calc(0.5rem+var(--wco-right))] hidden md:inline-flex"
      onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => {});
      }}
    >
      {full ? <Minimize size={18} /> : <Maximize size={18} />}
    </IconButton>
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
export function TopBar({
  title,
  compact = false,
  onShowRail,
  children,
}: {
  title: string;
  compact?: boolean;
  /** PC 왼쪽 메뉴를 숨겨 뒀을 때 — 다시 여는 버튼을 제목 앞에 둔다 */
  onShowRail?: () => void;
  children?: ReactNode;
}) {
  const { openSheet, setWallpaper } = usePlanner();
  const photo = useHasBackdrop();
  const now = useNow(30_000);
  return (
    // PC 설치 앱(창 제목 줄 숨김 모드)에선 이 막대가 창 맨 위 — 잡고 끌면 창이 움직이고, 오른쪽 위 창 버튼 자리는 비운다
    <header className="safe-top wco-drag sticky top-0 z-30 border-b border-line bg-[color-mix(in_oklab,var(--bg)_70%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 pr-[calc(1rem+var(--wco-right))] pl-4 md:h-16 md:pr-[calc(3.5rem+var(--wco-right))] md:pl-8">
        {onShowRail && (
          <IconButton label="메뉴 보이기" onClick={onShowRail} className="-ml-2 hidden size-9 md:inline-flex md:ml-[calc(var(--wco-left)-0.5rem)]">
            <PanelLeftOpen size={19} />
          </IconButton>
        )}
        <h1 className="text-xl font-black tracking-tight md:text-2xl">{title}</h1>
        <span className="hidden items-baseline gap-2 text-sm md:flex">
          <span className="font-semibold text-muted">{fmtDate(new Date(now))}</span>
          <span className="font-mono text-faint tabular-nums">{fmtTime(new Date(now))}</span>
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <InstallButton />
          <SyncPill />
          {photo && (
            <IconButton label="배경만 보기" onClick={() => setWallpaper(true)}>
              <ImageIcon size={19} />
            </IconButton>
          )}
          <button
            onClick={() => openSheet("voice")}
            className="hidden h-9 items-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-bold text-accent-fg md:inline-flex"
          >
            <Mic size={14} /> Voice
          </button>
          <IconButton label="말로 일정 추가" onClick={() => openSheet("voice")} className="md:hidden">
            <Mic size={20} />
          </IconButton>
        </div>
      </div>
      <FullscreenButton />
      {compact && <MiniStatus />}
      {children}
    </header>
  );
}

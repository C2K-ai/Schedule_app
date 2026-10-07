"use client";

import { Cloud, Mic, Plus, Share, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isIOS, isStandalone } from "@/lib/notify";
import { cloudEnabled } from "@/lib/supabase";
import { MIN, startOfDay } from "@/lib/time";
import { AlarmOverlay } from "./AlarmOverlay";
import { AuthForm } from "./AuthForm";
import { Board, type View } from "./Board";
import { EnforcementModal, OverdueSiren, PostponeDialog } from "./Enforcement";
import { FocusDock, FocusScreen } from "./Focus";
import { Header } from "./Header";
import { HabitsSheet } from "./HabitsSheet";
import { LogSheet } from "./LogSheet";
import { NowBar, OverdueBanner } from "./NowBar";
import { usePlanner } from "./PlannerProvider";
import { ReminderEngine } from "./ReminderEngine";
import { SettingsSheet } from "./SettingsSheet";
import { Agenda, HabitMini, ReasonFeed } from "./SidePanels";
import { TaskEditor } from "./TaskEditor";
import { Toasts } from "./Toasts";
import { VoiceAdd } from "./VoiceAdd";
import { Logo } from "./ui";

function InstallHint() {
  const { openSheet } = usePlanner();
  const [ios] = useState(() => isIOS());
  const [android] = useState(() => /Android/i.test(navigator.userAgent));
  const [show, setShow] = useState(() => {
    try {
      return !isStandalone() && !localStorage.getItem("must:install-hint-dismissed");
    } catch {
      return false;
    }
  });
  if (!show) return null;
  return (
    <div className="fade-up flex items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg">
        <Share size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">홈 화면에 설치하면 알림을 놓치지 않아요</p>
        <p className="mt-0.5 text-muted">
          {ios
            ? "Safari 아래쪽 공유 버튼 → ‘홈 화면에 추가’ → 설치된 앱을 열고 설정 → 알림 켜기. (iOS는 설치해야만 알림이 옵니다)"
            : android
              ? "Chrome 오른쪽 위 ⋮ → ‘앱 설치’ → 홈 화면의 MUST 로 열고 설정 → 알림 켜기. 배터리는 ‘제한 없음’으로."
              : "주소창 오른쪽 설치 아이콘(또는 상단 ‘앱 설치’)을 누르세요. 설치 후 설정 → 알림에서 권한을 켜면 됩니다."}
        </p>
        <button onClick={() => openSheet("settings", "notify")} className="mt-1.5 text-sm font-bold text-accent-text">
          알림 설정 열기 →
        </button>
      </div>
      <button
        aria-label="닫기"
        className="text-muted hover:text-fg"
        onClick={() => {
          try {
            localStorage.setItem("must:install-hint-dismissed", "1");
          } catch {
            /* 저장 못 해도 이번엔 닫기만 */
          }
          setShow(false);
        }}
      >
        <X size={18} />
      </button>
    </div>
  );
}

/** 서버는 연결돼 있는데 아직 로그인 전 — 맨 위에서 바로 로그인 */
function CloudLoginCard() {
  const { session } = usePlanner();
  const [open, setOpen] = useState(false);
  if (!cloudEnabled || !session.ready || session.userId) return null;
  return (
    <div className="fade-up rounded-2xl border border-accent/40 bg-[color-mix(in_oklab,var(--accent)_7%,var(--surface))] px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg">
          <Cloud size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">로그인하면 노트북 ↔ 폰이 연결돼요</p>
          <p className="text-xs text-muted">일정이 실시간으로 맞춰지고, 앱을 닫아도 서버가 알림을 보냅니다.</p>
        </div>
        {!open && (
          <button onClick={() => setOpen(true)} className="h-9 shrink-0 rounded-xl bg-accent px-3 text-sm font-bold text-accent-fg">
            로그인
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3 max-w-md">
          <AuthForm compact />
        </div>
      )}
    </div>
  );
}

export function Dashboard() {
  const p = usePlanner();
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [view, setView] = useState<View>("day");
  // 큰 상태 카드가 화면 밖으로 나가면 헤더에 한 줄 요약을 붙인다 → 지금/다음/달성률이 항상 보임
  const nowRef = useRef<HTMLDivElement>(null);
  const [nowVisible, setNowVisible] = useState(true);
  useEffect(() => {
    const el = nowRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNowVisible(e.isIntersecting), { rootMargin: "-64px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <Header onToday={() => setSelected(startOfDay(new Date()))} compact={!nowVisible} />
      <main className="mx-auto max-w-[1400px] space-y-4 px-4 pt-4 pb-36 md:px-6 md:pt-6">
        <CloudLoginCard />
        <InstallHint />
        <OverdueBanner
          onOpen={() => {
            p.setFocusScreen(false);
            p.openSheet(null);
            p.closeEditor();
          }}
        />
        <div ref={nowRef}>
          <NowBar />
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Board selected={selected} setSelected={setSelected} view={view} setView={setView} />
          <aside className="grid gap-4 md:grid-cols-2 lg:grid-cols-1">
            <Agenda day={selected} />
            <HabitMini />
            <div className="md:col-span-2 lg:col-span-1">
              <ReasonFeed />
            </div>
          </aside>
        </div>
        <footer className="flex items-center justify-center gap-2 pt-6 text-xs text-faint">
          <Logo className="scale-75 opacity-60" /> 미루지 못하는 플래너
        </footer>
      </main>

      {/* 모바일 추가 버튼 — 위: 말로 추가, 아래: 직접 추가 */}
      <button
        aria-label="말로 일정 추가"
        onClick={() => p.openSheet("voice")}
        className="fixed right-5 bottom-[164px] z-30 grid size-12 place-items-center rounded-full border border-line-strong bg-surface text-fg shadow-card active:scale-95 md:hidden"
      >
        <Mic size={22} />
      </button>
      <button
        aria-label="일정 추가"
        onClick={() => p.openEditor({ start: new Date(Math.ceil(Date.now() / (15 * MIN)) * 15 * MIN) })}
        className="fixed right-4 bottom-[92px] z-30 grid size-14 place-items-center rounded-2xl bg-accent text-accent-fg shadow-[0_10px_30px_-8px_var(--accent)] active:scale-95 md:hidden"
      >
        <Plus size={26} strokeWidth={2.5} />
      </button>

      <FocusDock />
      <FocusScreen />
      <TaskEditor />
      <PostponeDialog />
      <HabitsSheet />
      <LogSheet />
      <SettingsSheet />
      <VoiceAdd />
      <EnforcementModal suppressed={Boolean(p.alarm || p.editor || p.postpone)} />
      <AlarmOverlay />
      <OverdueSiren />
      <Toasts />
      <ReminderEngine />
    </>
  );
}

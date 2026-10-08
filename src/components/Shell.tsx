"use client";

import {
  Brain,
  BriefcaseBusiness,
  HardDrive,
  CalendarDays,
  Check,
  ListChecks,
  Menu as MenuIcon,
  Mic,
  NotebookPen,

  Plus,
  Repeat,
  PanelLeftClose,
  Settings as SettingsIcon,
  ShieldCheck,
  Star,
  Tag,
  Timer,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useIsAdmin } from "@/lib/admin";
import { createCategory, deleteCategory, liveCategories, updateCategory } from "@/lib/planner";
import { MIN } from "@/lib/time";
import { useMedia } from "@/lib/useMedia";
import { COLOR_HEX } from "@/lib/types";
import { ActivityEditor } from "./ActivityEditor";
import { AdminSheet } from "./AdminSheet";
import { DriveSheet } from "./DriveSheet";
import { PalettePicker } from "./PalettePicker";
import { AlarmOverlay } from "./AlarmOverlay";
import { BackgroundPicker } from "./BackgroundPicker";
import { Backdrop } from "./Backdrop";
import { BriefingEngine } from "./Briefing";
import { CalendarTab } from "./CalendarTab";
import { CareerSheet } from "./Career";
import { CompletedSheet } from "./CompletedSheet";
import { EnforcementModal, OverdueSiren, PostponeDialog, RescheduleDialog } from "./Enforcement";
import { FocusDock, FocusScreen } from "./Focus";
import { AutoFullscreen, TopBar } from "./Header";
import { HabitsSheet } from "./HabitsSheet";
import { ListManager } from "./ListManager";
import { LogSheet } from "./LogSheet";
import { MeTab } from "./MeTab";
import { OverdueBanner } from "./NowBar";
import { usePlanner } from "./PlannerProvider";
import { LockCardSync } from "./LockCardSync";
import { ReminderEngine } from "./ReminderEngine";
import { SettingsSheet } from "./SettingsSheet";
import { StudyDock, StudyEngine } from "./Study";
import { TaskEditor } from "./TaskEditor";
import { TasksTab, type TaskFilter } from "./TasksTab";
import { TimerTab } from "./TimerTab";
import { Toasts } from "./Toasts";
import { VoiceAdd } from "./VoiceAdd";
import { cx, IconButton, Logo, Segmented, useLayer } from "./ui";

export type Tab = "tasks" | "timer" | "calendar" | "me";

const TABS: { value: Tab; label: string; icon: typeof ListChecks }[] = [
  { value: "tasks", label: "작업", icon: ListChecks },
  { value: "timer", label: "타이머", icon: Timer },
  { value: "calendar", label: "캘린더", icon: CalendarDays },
  { value: "me", label: "프로필", icon: UserRound },
];

const TAB_KEY = "must:tab";
/** PC 왼쪽 메뉴를 접어 뒀는지 — 기기마다 따로 기억 */
const RAIL_KEY = "must:rail-hidden";
function readRailHidden(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
}
function readTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.some((x) => x.value === t) ? (t as Tab) : "tasks";
  } catch {
    return "tasks";
  }
}

function MenuItem({
  icon,
  label,
  n,
  active,
  onClick,
  dot,
}: {
  icon?: ReactNode;
  label: string;
  n?: number;
  active?: boolean;
  onClick: () => void;
  dot?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition",
        active ? "bg-accent/15 text-accent-text" : "text-fg hover:bg-surface-2",
      )}
    >
      {dot ? <span className="mx-1 size-2.5 shrink-0 rounded-full" style={{ background: dot }} /> : <span className="text-muted">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {n !== undefined && <span className="font-mono text-xs text-faint tabular-nums">{n}</span>}
    </button>
  );
}

function MenuHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-5 mb-1 flex items-center px-3">
      <p className="flex-1 text-[11px] font-bold tracking-widest text-faint uppercase">{children}</p>
      {action}
    </div>
  );
}

/** ☰ 메뉴 — 폰은 왼쪽에서 나오는 서랍, PC 는 왼쪽 레일에 늘 펼쳐 둔다 */
function MenuPanel({
  filter,
  onFilter,
  onCategories,
  onCareer,
}: {
  filter: TaskFilter;
  onFilter: (f: TaskFilter) => void;
  onCategories: () => void;
  onCareer: () => void;
}) {
  const p = usePlanner();
  const isAdmin = useIsAdmin(p.session.userId);
  const categories = useMemo(() => liveCategories(p.snap.db), [p.snap.db]);
  const open = p.tasks.filter((t) => t.status === "planned" || t.status === "in_progress");
  const count = (fn: (t: (typeof open)[number]) => boolean) => open.filter(fn).length;
  return (
    <nav className="space-y-0.5">
      <MenuItem
        icon={<Star size={17} />}
        label="별표 작업"
        n={count((t) => t.starred)}
        active={filter.kind === "starred"}
        onClick={() => onFilter({ kind: "starred" })}
      />
      <MenuHeading
        action={
          <button onClick={onCategories} className="text-xs font-semibold text-muted hover:text-fg">
            편집
          </button>
        }
      >
        카테고리
      </MenuHeading>
      <MenuItem icon={<Tag size={17} />} label="모두" n={open.length} active={filter.kind === "all"} onClick={() => onFilter({ kind: "all" })} />
      {categories.map((c) => (
        <MenuItem
          key={c.id}
          dot={COLOR_HEX[c.color]}
          label={c.name}
          n={count((t) => t.category_id === c.id)}
          active={filter.kind === "category" && filter.id === c.id}
          onClick={() => onFilter({ kind: "category", id: c.id })}
        />
      ))}
      <MenuItem icon={<Plus size={17} />} label="새로 만들기" onClick={onCategories} />

      <MenuHeading>기록</MenuHeading>
      <MenuItem icon={<Repeat size={17} />} label="습관" onClick={() => p.openSheet("habits")} />
      <MenuItem icon={<BriefcaseBusiness size={17} />} label="커리어 기록" onClick={onCareer} />
      <MenuItem icon={<HardDrive size={17} />} label="드라이브" onClick={() => p.openSheet("drive")} />
      <MenuItem icon={<NotebookPen size={17} />} label="변명 노트·주간 리포트" onClick={() => p.openSheet("log")} />
      <MenuItem icon={<Brain size={17} />} label="집중(뽀모도로)" onClick={() => p.setFocusScreen(true)} />

      <MenuHeading>테마</MenuHeading>
      <div className="px-3 pb-1">
        <PalettePicker compact />
        {p.settings.palette === "dusk" && (
          <div className="mt-2.5">
            <BackgroundPicker compact />
          </div>
        )}
        {p.settings.palette !== "dusk" && (
          <Segmented
            className="mt-2"
            value={p.settings.theme}
            onChange={(theme) => p.updateSettings({ theme })}
            options={[
              { value: "system", label: "자동" },
              { value: "dark", label: "어둡게" },
              { value: "light", label: "밝게" },
            ]}
          />
        )}
      </div>
      <div className="pt-3">
        <MenuItem icon={<SettingsIcon size={17} />} label="설정" onClick={() => p.openSheet("settings")} />
        {isAdmin && <MenuItem icon={<ShieldCheck size={17} />} label="관리자" onClick={() => p.openSheet("admin")} />}
      </div>
    </nav>
  );
}

export function Shell() {
  const p = usePlanner();
  const [tab, setTabState] = useState<Tab>(readTab);
  const [filter, setFilter] = useState<TaskFilter>({ kind: "all" });
  const [drawer, setDrawer] = useState(false);
  const [catEdit, setCatEdit] = useState(false);
  const [career, setCareer] = useState(false);
  const [railHidden, setRailHidden] = useState(readRailHidden);
  const toggleRail = () =>
    setRailHidden((h) => {
      try {
        localStorage.setItem(RAIL_KEY, h ? "0" : "1");
      } catch {
        /* 저장 못 해도 이번엔 바뀜 */
      }
      return !h;
    });
  const categories = useMemo(() => liveCategories(p.snap.db), [p.snap.db]);
  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of p.tasks) if (t.category_id) m.set(t.category_id, (m.get(t.category_id) ?? 0) + 1);
    return m;
  }, [p.tasks]);

  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* 저장 못 해도 이번엔 바뀜 */
    }
    window.scrollTo({ top: 0 });
  };
  const pickFilter = (f: TaskFilter) => {
    setFilter(f);
    setTab("tasks");
    setDrawer(false);
  };

  // 작업 탭의 큰 '지금' 카드가 화면 밖으로 나가면 위쪽 막대에 한 줄 요약
  const [nowVisible, setNowVisible] = useState(true);
  const nowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = nowRef.current;
    if (!el || tab !== "tasks") return;
    const io = new IntersectionObserver(([e]) => setNowVisible(e.isIntersecting), { rootMargin: "-64px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [tab]);

  // 화면이 넓어지면(폰 가로 회전·창 넓히기) 서랍은 사라지므로 닫아 둔다 — 안 그러면 스크롤 잠금만 남는다
  const wide = useMedia("(min-width: 768px)");
  useEffect(() => {
    // 외부(화면 크기) 변화에 맞춰 닫기
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (wide) setDrawer(false);
  }, [wide]);

  // 서랍 열린 동안 뒤 화면 스크롤 막기 + Esc 로 닫기(위에 창이 떠 있으면 그 창부터)
  useLayer(drawer, () => setDrawer(false));

  const title = TABS.find((t) => t.value === tab)!.label;
  const addNew = () => {
    p.openEditor({ start: new Date(Math.ceil(Date.now() / (15 * MIN)) * 15 * MIN), categoryId: filter.kind === "category" ? filter.id : undefined });
  };
  const menu = <MenuPanel filter={filter} onFilter={pickFilter} onCategories={() => setCatEdit(true)} onCareer={() => (setCareer(true), setDrawer(false))} />;

  return (
    <>
      <Backdrop />
      <AutoFullscreen enabled={p.settings.pcFullscreen} />

      {/* PC: 왼쪽 레일 */}
      <aside
        aria-hidden={railHidden}
        inert={railHidden}
        className={cx(
          "fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-line bg-[color-mix(in_oklab,var(--bg)_72%,transparent)] backdrop-blur-xl transition-transform duration-200 md:flex",
          railHidden && "-translate-x-full",
        )}
      >
        {/* PC 설치 앱에선 이 줄과 위쪽 막대를 잡고 창을 옮긴다(맥은 왼쪽 위 창 버튼만큼 비움) */}
        <div className="wco-drag flex h-16 items-center pr-3 pl-[calc(1.25rem+var(--wco-left))]">
          <Logo />
          <IconButton label="메뉴 숨기기" onClick={toggleRail} className="ml-auto size-9">
            <PanelLeftClose size={19} />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-6">
          <div className="space-y-0.5">
            {TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                className={cx(
                  "flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[15px] font-bold transition",
                  tab === t.value ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <t.icon size={19} /> {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => p.openSheet("voice")}
            className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-accent/50 text-sm font-bold text-accent-text hover:bg-accent/10"
          >
            <Mic size={17} /> 말로 일정 추가
          </button>
          <button
            onClick={() => p.openActivity({})}
            className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-did/60 text-sm font-bold text-did hover:bg-did-soft"
          >
            <Check size={17} strokeWidth={2.75} /> 한 일 기록
          </button>
          <div className="mt-2 border-t border-line pt-2">{menu}</div>
        </div>
      </aside>

      <div className={cx("min-h-dvh transition-[padding] duration-200", railHidden ? "md:pl-0" : "md:pl-[264px]")}>
        <TopBar title={title} compact={tab === "tasks" && !nowVisible} onShowRail={railHidden ? toggleRail : undefined}>
          <StudyDock onOpen={() => setTab("timer")} hidden={tab === "timer"} />
        </TopBar>
        <main className="mx-auto max-w-[1200px] space-y-4 px-4 pt-4 pb-40 md:px-8 md:pt-6 md:pb-24">
          <OverdueBanner
            onOpen={() => {
              p.setFocusScreen(false);
              p.openSheet(null);
              p.closeEditor();
            }}
          />
          {tab === "tasks" && <TasksTab filter={filter} setFilter={setFilter} nowRef={nowRef} onManageCategories={() => setCatEdit(true)} />}
          {tab === "timer" && <TimerTab />}
          {tab === "calendar" && <CalendarTab />}
          {tab === "me" && <MeTab onCareer={() => setCareer(true)} />}
        </main>
      </div>

      {/* 폰: 아래 탭바 + 둥근 + 버튼 */}
      <div className="md:hidden">
        <div className="fixed right-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 flex flex-col items-end gap-2.5">
          <button
            aria-label="한 일 기록"
            onClick={() => p.openActivity({})}
            className="inline-flex h-10 items-center gap-1.5 rounded-full border border-dashed border-did/70 bg-[color-mix(in_oklab,var(--surface)_85%,transparent)] px-3.5 text-[13px] font-bold text-did shadow-lg backdrop-blur-md active:scale-95"
          >
            <Check size={16} strokeWidth={3} /> 한 일
          </button>
          <button
            aria-label="추가"
            onClick={addNew}
            className="grid size-14 place-items-center rounded-full bg-accent text-accent-fg shadow-[0_10px_30px_-8px_var(--accent)] active:scale-95"
          >
            <Plus size={28} strokeWidth={2.5} />
          </button>
        </div>
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[color-mix(in_oklab,var(--bg)_80%,transparent)] backdrop-blur-xl">
          <div className="grid h-16 grid-cols-5">
            <button onClick={() => setDrawer(true)} className="flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-muted">
              <MenuIcon size={22} />
              메뉴
            </button>
            {TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                aria-current={tab === t.value ? "page" : undefined}
                className={cx(
                  "flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition",
                  tab === t.value ? "text-accent-text" : "text-muted",
                )}
              >
                <t.icon size={22} strokeWidth={tab === t.value ? 2.4 : 2} />
                {t.label}
              </button>
            ))}
          </div>
        </nav>
        {drawer && (
          <div className="fixed inset-0 z-40" role="dialog" aria-modal aria-label="메뉴">
            <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setDrawer(false)} />
            <div className="drawer-in safe-top absolute inset-y-0 left-0 flex w-[84%] max-w-[320px] flex-col border-r border-line bg-[color-mix(in_oklab,var(--bg)_92%,transparent)] backdrop-blur-xl">
              <div className="flex h-14 items-center justify-between px-4">
                <Logo />
                <button aria-label="닫기" onClick={() => setDrawer(false)} className="grid size-10 place-items-center rounded-xl text-muted">
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-8">{menu}</div>
            </div>
          </div>
        )}
      </div>

      <ListManager
        open={catEdit}
        onClose={() => setCatEdit(false)}
        title="카테고리"
        subtitle="지워도 그 카테고리의 할 일은 남아요(카테고리 없음으로)."
        items={categories}
        counts={catCounts}
        placeholder="새 카테고리 이름"
        onCreate={(name, color) => createCategory(p.store, name, color)}
        onUpdate={(id, patch) => updateCategory(p.store, id, patch)}
        onDelete={(c) => {
          deleteCategory(p.store, c.id);
          if (filter.kind === "category" && filter.id === c.id) setFilter({ kind: "all" });
        }}
      />
      <CareerSheet open={career} onClose={() => setCareer(false)} />

      <FocusDock />
      <FocusScreen />
      {/* 완료 목록에서 일정을 누르면 편집 창이 그 위에 떠야 한다 — 편집기를 뒤에 둔다 */}
      <CompletedSheet />
      <TaskEditor />
      <ActivityEditor />
      <PostponeDialog />
      <RescheduleDialog />
      <HabitsSheet />
      <LogSheet />
      <SettingsSheet />
      <AdminSheet />
      <DriveSheet />
      <VoiceAdd />
      <EnforcementModal suppressed={Boolean(p.alarm || p.editor || p.activityEditor || p.reschedule || p.postpone)} />
      <AlarmOverlay />
      <OverdueSiren />
      <Toasts />
      <ReminderEngine />
      <LockCardSync />
      <StudyEngine />
      <BriefingEngine />
    </>
  );
}


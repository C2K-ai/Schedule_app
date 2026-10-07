"use client";

import { Check, ChevronDown, ChevronRight, CircleDashed, Cloud, Plus, Repeat, Settings2, Share, SlidersHorizontal, Star, TriangleAlert, X } from "lucide-react";
import { useMemo, useState, type ReactNode, type RefObject } from "react";
import { isIOS, isStandalone } from "@/lib/notify";
import {
  completeTask,
  createTask,
  groupTasks,
  isTimed,
  liveCategories,
  reopenTask,
  taskState,
  toggleStar,
} from "@/lib/planner";
import { cloudEnabled } from "@/lib/supabase";
import { addDays, DAY, dayKey, fmtTime, startOfDay, WEEKDAYS } from "@/lib/time";
import { COLOR_HEX, type Category, type ScheduleKind, type Task } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { AuthForm } from "./AuthForm";
import { BriefingCard } from "./Briefing";
import { NowStrip } from "./NowBar";
import { usePlanner } from "./PlannerProvider";
import { Card, cx, Empty } from "./ui";

export type TaskFilter = { kind: "all" } | { kind: "starred" } | { kind: "category"; id: string };

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
              ? "Chrome 오른쪽 위 ⋮ → ‘앱 설치’ → 홈 화면의 DREAM 으로 열고 설정 → 알림 켜기. 배터리는 ‘제한 없음’으로."
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

function dateLabel(iso: string, now: Date) {
  const d = new Date(iso);
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / DAY);
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  if (diff === -1) return "어제";
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

export function TaskRow({ t, categories, showDate = false }: { t: Task; categories: Category[]; showDate?: boolean }) {
  const { store, settings, openEditor, toast } = usePlanner();
  const now = useNow(15_000);
  const st = taskState(t, now, settings.graceMin);
  const done = t.status === "done";
  const closed = done || t.status === "skipped" || t.status === "missed";
  const cat = categories.find((c) => c.id === t.category_id);
  const timed = isTimed(t);
  return (
    <li className={cx("group flex items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-surface-2/70", st === "overdue" && "bg-danger-soft")}>
      <button
        aria-label={done ? "완료 취소" : "완료"}
        onClick={() => {
          if (done) return reopenTask(store, t.id);
          if (closed) return;
          completeTask(store, t.id);
          toast({ text: `✓ ${t.title}`, tone: "ok", action: { label: "되돌리기", onClick: () => reopenTask(store, t.id) } });
        }}
        className={cx(
          "grid size-6 shrink-0 place-items-center rounded-full border-2 transition",
          done ? "border-ok bg-ok text-white" : st === "overdue" ? "border-danger" : "border-line-strong hover:border-accent",
        )}
      >
        {done && <Check size={14} strokeWidth={3} />}
        {st === "overdue" && <TriangleAlert size={11} className="text-danger" />}
      </button>
      <button onClick={() => openEditor({ taskId: t.id })} className="min-w-0 flex-1 text-left">
        <p className={cx("truncate text-[15px] font-semibold", closed && "text-muted line-through")}>
          {t.habit_id && <Repeat size={12} className="mr-1 inline text-muted" />}
          {t.title}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
          {timed && (
            <span className={cx("font-mono tabular-nums", st === "overdue" && "font-bold text-danger")}>
              {showDate && `${dateLabel(t.starts_at, new Date(now))} `}
              {fmtTime(t.starts_at)}–{fmtTime(t.ends_at)}
            </span>
          )}
          {!timed && showDate && t.schedule === "day" && <span>{dateLabel(t.starts_at, new Date(now))}</span>}
          {st === "overdue" && <span className="font-bold text-danger">미시작</span>}
          {st === "in_progress" && <span className="font-bold text-accent-text">진행 중</span>}
          {cat && (
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full" style={{ background: COLOR_HEX[cat.color] }} />
              {cat.name}
            </span>
          )}
          {t.postpone_count > 0 && <span className="text-warn">{t.postpone_count}회 미룸</span>}
        </p>
      </button>
      <button
        aria-label={t.starred ? "별표 빼기" : "별표"}
        onClick={() => toggleStar(store, t.id)}
        className={cx("grid size-8 shrink-0 place-items-center rounded-lg", t.starred ? "text-warn" : "text-faint hover:text-muted")}
      >
        <Star size={18} fill={t.starred ? "currentColor" : "none"} />
      </button>
    </li>
  );
}

function Group({
  title,
  tasks,
  categories,
  tone,
  showDate,
  collapsible,
  defaultOpen = true,
}: {
  title: ReactNode;
  tasks: Task[];
  categories: Category[];
  tone?: "danger";
  showDate?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!tasks.length) return null;
  const head = (
    <span className={cx("flex items-center gap-1.5 text-[13px] font-bold", tone === "danger" ? "text-danger" : "text-muted")}>
      {collapsible && (open ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
      {title} <span className="font-mono tabular-nums">({tasks.length})</span>
    </span>
  );
  return (
    <section>
      {collapsible ? (
        <button onClick={() => setOpen(!open)} className="px-3 py-1.5">
          {head}
        </button>
      ) : (
        <div className="px-3 py-1.5">{head}</div>
      )}
      {open && (
        <ul>
          {tasks.map((t) => (
            <TaskRow key={t.id} t={t} categories={categories} showDate={showDate} />
          ))}
        </ul>
      )}
    </section>
  );
}

const WHEN: { value: "today" | "tomorrow" | "someday"; label: string }[] = [
  { value: "today", label: "오늘" },
  { value: "tomorrow", label: "내일" },
  { value: "someday", label: "날짜 없음" },
];

function QuickAdd({ filter }: { filter: TaskFilter }) {
  const { store, settings, openEditor, toast } = usePlanner();
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState<(typeof WHEN)[number]["value"]>("today");
  const categoryId = filter.kind === "category" ? filter.id : null;
  const starred = filter.kind === "starred";
  const schedule: ScheduleKind = when === "someday" ? "someday" : "day";
  const day = dayKey(when === "tomorrow" ? addDays(new Date(), 1) : new Date());
  const add = () => {
    const v = title.trim();
    if (!v) return;
    createTask(store, { title: v, schedule, day, category_id: categoryId, starred }, settings);
    setTitle("");
    toast({ text: `추가: ${v}`, tone: "ok" });
  };
  const label = WHEN.find((w) => w.value === when)!.label;
  return (
    <div className="flex items-center gap-1 rounded-2xl border border-line bg-surface py-1.5 pr-1.5 pl-3 shadow-card">
      <Plus size={18} className="shrink-0 text-muted" />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && add()}
        placeholder="할 일 추가"
        className="h-10 min-w-0 flex-1 bg-transparent px-1 text-[15px] outline-none placeholder:text-faint"
        aria-label="빠른 추가"
      />
      <button
        onClick={() => setWhen(WHEN[(WHEN.findIndex((w) => w.value === when) + 1) % WHEN.length].value)}
        title="누를 때마다 바뀌어요"
        className="h-8 shrink-0 rounded-lg bg-accent/15 px-2.5 text-xs font-bold text-accent-text"
      >
        {label}
      </button>
      <button
        onClick={() => openEditor({ schedule, day, categoryId: categoryId ?? undefined, starred, title: title.trim() || undefined })}
        aria-label="자세히"
        className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
      >
        <SlidersHorizontal size={17} />
      </button>
    </div>
  );
}

export function TasksTab({
  filter,
  setFilter,
  nowRef,
  onManageCategories,
}: {
  filter: TaskFilter;
  setFilter: (f: TaskFilter) => void;
  nowRef: RefObject<HTMLDivElement | null>;
  onManageCategories: () => void;
}) {
  const { tasks, snap, openSheet } = usePlanner();
  const now = useNow(60_000);
  const categories = useMemo(() => liveCategories(snap.db), [snap.db]);
  const filtered = useMemo(
    () =>
      tasks.filter((t) =>
        filter.kind === "starred" ? t.starred : filter.kind === "category" ? t.category_id === filter.id : true,
      ),
    [tasks, filter],
  );
  const g = useMemo(() => groupTasks(filtered, new Date(now)), [filtered, now]);
  const openCount = g.overdue.length + g.today.length + g.tomorrow.length + g.later.length + g.someday.length;

  const chip = (active: boolean, onClick: () => void, children: ReactNode, key?: string) => (
    <button
      key={key}
      onClick={onClick}
      className={cx(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition",
        active ? "bg-accent text-accent-fg" : "bg-surface text-muted backdrop-blur hover:text-fg",
      )}
    >
      {children}
    </button>
  );

  return (
    <div className="space-y-5">
      <CloudLoginCard />
      <InstallHint />
      <BriefingCard />
      <div ref={nowRef}>
        <NowStrip />
      </div>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
        {chip(filter.kind === "all", () => setFilter({ kind: "all" }), "모두")}
        {chip(filter.kind === "starred", () => setFilter({ kind: "starred" }), <><Star size={14} fill="currentColor" /> 별표</>)}
        {categories.map((c) =>
          chip(
            filter.kind === "category" && filter.id === c.id,
            () => setFilter({ kind: "category", id: c.id }),
            <>
              <span className="size-2 rounded-full" style={{ background: COLOR_HEX[c.color] }} />
              {c.name}
            </>,
            c.id,
          ),
        )}
        <button onClick={onManageCategories} aria-label="카테고리 편집" className="grid size-9 shrink-0 place-items-center rounded-full bg-surface text-muted hover:text-fg">
          <Settings2 size={16} />
        </button>
      </div>

      <QuickAdd filter={filter} />

      <Card className="py-2">
        {openCount === 0 && g.doneToday.length === 0 ? (
          <Empty
            icon={<CircleDashed size={22} />}
            title={filter.kind === "all" ? "할 일이 없어요" : "여기엔 아직 없어요"}
            desc="위 칸에 적거나, 🎤 로 말해서 넣어 보세요."
          />
        ) : (
          <div className="space-y-3 px-1">
            <Group title="지난 일정" tasks={g.overdue} categories={categories} tone="danger" showDate />
            <Group title="오늘" tasks={g.today} categories={categories} />
            <Group title="내일" tasks={g.tomorrow} categories={categories} />
            <Group title="다가오는 일정" tasks={g.later} categories={categories} showDate />
            <Group title="날짜 없음" tasks={g.someday} categories={categories} />
            <Group title="오늘 완료" tasks={g.doneToday} categories={categories} collapsible defaultOpen={false} />
          </div>
        )}
      </Card>
      <div className="text-center">
        <button onClick={() => openSheet("completed")} className="text-sm font-semibold text-muted underline-offset-4 hover:text-fg hover:underline">
          완료된 모든 작업 확인
        </button>
      </div>
    </div>
  );
}

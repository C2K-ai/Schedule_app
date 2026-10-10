"use client";

import type { PlannerStore } from "./store";
import { addDays, atTime, dayKey, DAY, MIN, nowIso, parseDayKey, startOfDay, uuid } from "./time";
import { dayNoteId } from "./ids";
import type {
  Activity,
  CareerEntry,
  Category,
  ColorKey,
  DayNote,
  DB,
  FocusMode,
  FocusSession,
  Habit,
  LogKind,
  ScheduleKind,
  Settings,
  StudySession,
  Subject,
  Task,
  TaskLog,
} from "./types";

// ───────────────────────── 선택자 ─────────────────────────

export function liveTasks(db: DB): Task[] {
  return Object.values(db.tasks)
    .filter((t) => !t.deleted_at)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

export function liveHabits(db: DB): Habit[] {
  return Object.values(db.habits)
    .filter((h) => !h.deleted_at)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
}

/** 시각이 정해진 일정 — 알림·강제·타임라인 대상 (예전 데이터는 schedule 이 없으면 timed) */
export const isTimed = (t: Task) => (t.schedule ?? "timed") === "timed";
export const isSomeday = (t: Task) => t.schedule === "someday";

/** 그날의 일정(시각 지정 + 날짜만). 날짜 없는 할 일은 빠진다. */
export function tasksOnDay(tasks: Task[], day: Date): Task[] {
  const key = dayKey(day);
  return tasks.filter((t) => !isSomeday(t) && dayKey(new Date(t.starts_at)) === key);
}

/** 그날 완료한 것(완료 시각 기준 — 날짜 없는 할 일 포함) */
export function completedOn(tasks: Task[], day: Date): Task[] {
  const key = dayKey(day);
  return tasks.filter((t) => t.status === "done" && t.completed_at && dayKey(new Date(t.completed_at)) === key);
}

export function liveCategories(db: DB): Category[] {
  return Object.values(db.categories)
    .filter((c) => !c.deleted_at)
    .sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
}

export function dayNoteFor(db: DB, day: string): DayNote | null {
  const n = Object.values(db.day_notes).find((x) => x.day === day && !x.deleted_at);
  return n ?? null;
}

export interface TaskGroups {
  /** 지난 날짜인데 아직 안 끝낸 것(습관 회차 제외) */
  overdue: Task[];
  today: Task[];
  tomorrow: Task[];
  /** 모레 이후 */
  later: Task[];
  someday: Task[];
  /** 오늘 완료한 것(완료 시각 기준) */
  doneToday: Task[];
  /** 오늘 못 한 것(놓침·건너뜀) — 그날 하루만 남겨 두고, 누르면 다시 잡는다 */
  missedToday: Task[];
}

const isOpen = (t: Task) => t.status === "planned" || t.status === "in_progress";
/** 못 한 일정(놓침·건너뜀) — 누르면 편집 대신 '다시 잡기' 창이 뜬다 */
export const isMissed = (t: Task) => t.status === "missed" || t.status === "skipped";

/** 작업 탭 목록 — 습관 회차는 오늘 것만 보여 준다(앞으로 7일치가 미리 만들어져 있어 목록이 넘친다) */
export function groupTasks(tasks: Task[], now: Date): TaskGroups {
  const today = dayKey(now);
  const tomorrow = dayKey(addDays(startOfDay(now), 1));
  const g: TaskGroups = { overdue: [], today: [], tomorrow: [], later: [], someday: [], doneToday: [], missedToday: [] };
  for (const t of tasks) {
    if (t.status === "done") {
      if (t.completed_at && dayKey(new Date(t.completed_at)) === today) g.doneToday.push(t);
      continue;
    }
    if (!isOpen(t)) {
      if (isMissed(t) && !isSomeday(t) && dayKey(new Date(t.starts_at)) === today) g.missedToday.push(t);
      continue;
    }
    if (isSomeday(t)) {
      g.someday.push(t);
      continue;
    }
    const k = dayKey(new Date(t.starts_at));
    if (k === today) g.today.push(t);
    else if (t.habit_id) continue;
    else if (k < today) g.overdue.push(t);
    else if (k === tomorrow) g.tomorrow.push(t);
    else g.later.push(t);
  }
  // 날짜만 일정은 그날 0시라 시각 일정보다 앞에 온다 — 같은 날 안에선 시각 일정 먼저
  const dk = (t: Task) => dayKey(new Date(t.starts_at));
  const byTime = (a: Task, b: Task) =>
    dk(a) === dk(b)
      ? Number(!isTimed(a)) - Number(!isTimed(b)) || a.starts_at.localeCompare(b.starts_at)
      : a.starts_at.localeCompare(b.starts_at);
  g.overdue.sort(byTime);
  g.today.sort((a, b) => Number(!isTimed(a)) - Number(!isTimed(b)) || a.starts_at.localeCompare(b.starts_at));
  g.tomorrow.sort(byTime);
  g.later.sort(byTime);
  g.someday.sort((a, b) => Number(b.starred) - Number(a.starred) || b.created_at.localeCompare(a.created_at));
  g.doneToday.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  g.missedToday.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return g;
}

/** 화면 표시용 파생 상태 */
export type TaskState =
  | "done"
  | "skipped"
  | "missed"
  | "in_progress"
  | "unchecked" // 끝 시각이 지났는데 체크를 안 함 → 실패로 치지 않고 '했나요?' 물어본다
  | "overdue" // 유예 시간도 지났는데 시작 안 함 → 빨간 경고
  | "late" // 시작 시각은 지났지만 유예 시간 안
  | "soon" // 10분 안에 시작
  | "upcoming";

export function taskState(t: Task, now: number, graceMin: number): TaskState {
  if (t.status === "done") return "done";
  if (t.status === "skipped") return "skipped";
  if (t.status === "missed") return "missed";
  if (t.status === "in_progress") return "in_progress";
  if (!isTimed(t)) return "upcoming"; // 날짜만·날짜 없음은 시각 경고 대상이 아니다
  if (now >= Date.parse(t.ends_at)) return "unchecked";
  const start = Date.parse(t.starts_at);
  if (now >= start + graceMin * MIN) return "overdue";
  if (now >= start) return "late";
  if (start - now <= 10 * MIN) return "soon";
  return "upcoming";
}

export interface DayStats {
  total: number;
  done: number;
  skipped: number;
  missed: number;
  inProgress: number;
  remaining: number;
  overdue: number;
  /** 끝났는데 아직 했는지 답하지 않은 일정 */
  unchecked: number;
  rate: number;
  focusMin: number;
}

export function dayStats(tasks: Task[], now: number, graceMin: number, focus: FocusSession[] = []): DayStats {
  let done = 0,
    skipped = 0,
    missed = 0,
    inProgress = 0,
    overdue = 0,
    unchecked = 0;
  for (const t of tasks) {
    const s = taskState(t, now, graceMin);
    if (s === "done") done++;
    else if (s === "skipped") skipped++;
    else if (s === "missed") missed++;
    else if (s === "in_progress") inProgress++;
    else if (s === "overdue") overdue++;
    else if (s === "unchecked") unchecked++;
  }
  const total = tasks.length;
  const focusMin = focus
    .filter((f) => f.mode === "focus" && f.completed)
    .reduce((n, f) => n + (Date.parse(f.planned_end) - Date.parse(f.started_at)) / MIN, 0);
  return {
    total,
    done,
    skipped,
    missed,
    inProgress,
    overdue,
    unchecked,
    remaining: total - done - skipped - missed,
    // 건너뛴 것도 '안 한 것' — 분모에서 빼주지 않는다
    rate: total ? Math.round((done / total) * 100) : 0,
    focusMin: Math.round(focusMin),
  };
}

export function currentTask(tasks: Task[], now: number): Task | null {
  tasks = tasks.filter(isTimed);
  const running = tasks
    .filter((t) => t.status === "in_progress")
    .sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""));
  if (running[0]) return running[0];
  return (
    tasks.find(
      (t) => t.status === "planned" && Date.parse(t.starts_at) <= now && now < Date.parse(t.ends_at),
    ) ?? null
  );
}

export function nextTask(tasks: Task[], now: number): Task | null {
  return tasks.find((t) => isTimed(t) && t.status === "planned" && Date.parse(t.starts_at) > now) ?? null;
}

/** 강제 대상: 강제 모드 + 아직 planned + 유예 시간 초과 (최근 7일) */
/** 강제 모드 미시작 경고 — 일정 시간 안(유예 뒤 ~ 끝 전)에만. 끝난 뒤엔 실패로 치지 않고 checkinQueue 가 '했나요?' 묻는다 */
export function enforcementQueue(tasks: Task[], now: number, graceMin: number): Task[] {
  return tasks.filter(
    (t) =>
      isTimed(t) &&
      t.strict &&
      t.status === "planned" &&
      now >= Date.parse(t.starts_at) + graceMin * MIN &&
      now < Date.parse(t.ends_at),
  );
}

/** 끝났는데 체크를 안 한 일정(최근 7일) — 앱을 열면 '했나요?' 하나씩 묻는다. 오래된 것부터 */
export function checkinQueue(tasks: Task[], now: number): Task[] {
  return tasks
    .filter(
      (t) =>
        isTimed(t) &&
        t.status === "planned" &&
        now >= Date.parse(t.ends_at) &&
        now - Date.parse(t.ends_at) < 7 * DAY,
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

export function isExpired(t: Task, now: number) {
  return now >= Date.parse(t.ends_at);
}

export function activeFocus(db: DB): FocusSession | null {
  return (
    Object.values(db.focus_sessions)
      .filter((f) => !f.deleted_at && !f.ended_at)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null
  );
}

export function focusRemaining(f: FocusSession, now: number): number {
  const ref = f.paused_at ? Date.parse(f.paused_at) : now;
  return Math.max(0, Date.parse(f.planned_end) - ref);
}

export function recentLogs(db: DB, sinceMs: number): TaskLog[] {
  return Object.values(db.task_logs)
    .filter((l) => !l.deleted_at && Date.parse(l.created_at) >= sinceMs)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** 연속 달성 일수 — 오늘은 아직 안 했어도 끊지 않는다 */
export function habitStreak(h: Habit, tasks: Task[], today: Date): number {
  const byDay = new Map<string, Task>();
  for (const t of tasks) if (t.habit_id === h.id && t.occurrence_date) byDay.set(t.occurrence_date, t);
  let streak = 0;
  const created = startOfDay(new Date(h.created_at));
  for (let i = 0; i < 400; i++) {
    const d = addDays(startOfDay(today), -i);
    if (d < created) break;
    if (!h.days.includes(d.getDay())) continue;
    const t = byDay.get(dayKey(d));
    if (t?.status === "done") streak++;
    else if (i === 0) continue;
    else break;
  }
  return streak;
}

// ───────────────────────── 동작 ─────────────────────────

function log(
  store: PlannerStore,
  kind: LogKind,
  task: Task | null,
  extra: Partial<TaskLog> = {},
) {
  const now = nowIso();
  const row: TaskLog = {
    id: uuid(),
    task_id: task?.id ?? null,
    kind,
    reason: null,
    from_starts_at: null,
    to_starts_at: null,
    title: task?.title ?? null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ...extra,
  };
  store.put("task_logs", row);
}

export interface TaskInput {
  title: string;
  notes?: string | null;
  color?: ColorKey;
  /** 기본 timed. day 면 day(YYYY-MM-DD)만, someday 면 날짜 없이 */
  schedule?: ScheduleKind;
  starts_at?: string;
  ends_at?: string;
  day?: string;
  category_id?: string | null;
  starred?: boolean;
  reminder_offsets?: number[];
  sound_id?: string | null;
  strict?: boolean;
}

/** 일정 종류에 맞는 시작·끝 — 날짜만은 그날 0시~다음날 0시, 날짜 없음은 만든 시각(정렬용) */
export function scheduleWindow(kind: ScheduleKind, opts: { day?: string; starts_at?: string; ends_at?: string }) {
  if (kind === "day") {
    const d = parseDayKey(opts.day ?? dayKey(new Date()));
    return { starts_at: d.toISOString(), ends_at: addDays(d, 1).toISOString() };
  }
  if (kind === "someday") {
    const now = new Date();
    return { starts_at: now.toISOString(), ends_at: new Date(now.getTime() + MIN).toISOString() };
  }
  return { starts_at: opts.starts_at!, ends_at: opts.ends_at! };
}

export function createTask(store: PlannerStore, input: TaskInput, settings: Settings): Task {
  const now = nowIso();
  const kind = input.schedule ?? "timed";
  const timed = kind === "timed";
  const win = scheduleWindow(kind, input);
  const t: Task = {
    id: uuid(),
    habit_id: null,
    occurrence_date: null,
    title: input.title.trim(),
    notes: input.notes ?? null,
    color: input.color ?? "lime",
    starts_at: win.starts_at,
    ends_at: win.ends_at,
    status: "planned",
    started_at: null,
    completed_at: null,
    // 알림·강제는 시각이 정해진 일정에만
    reminder_offsets: timed ? (input.reminder_offsets ?? settings.defaultOffsets) : [],
    sound_id: input.sound_id ?? null,
    strict: timed ? (input.strict ?? true) : false,
    postpone_count: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    schedule: kind,
    category_id: input.category_id ?? null,
    starred: input.starred ?? false,
  };
  store.put("tasks", t);
  return t;
}

/**
 * 인박스(날짜 없음·날짜만)의 할 일을 시간표의 한 시각에 놓는다(PC 끌어 놓기) — 시각 일정이 되고 알림도 기본값으로.
 * 이미 지난 시각이면 강제 모드는 끈다(놓자마자 '미시작' 경고가 뜨지 않게).
 */
export function placeTask(store: PlannerStore, id: string, start: Date, settings: Settings, minutes = 60) {
  const t = store.db.tasks[id];
  if (!t || t.deleted_at) return;
  const end = new Date(start.getTime() + minutes * MIN);
  store.patch("tasks", id, {
    schedule: "timed",
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    reminder_offsets: t.reminder_offsets.length ? t.reminder_offsets : settings.defaultOffsets,
    strict: end.getTime() > Date.now(),
  });
}

/** 인박스 — 아직 시각을 안 정한 할 일(날짜 없음 + 오늘 이후 날짜만). 날짜 있는 것 먼저, 그다음 날짜 없음(만든 순) */
export function inboxTasks(tasks: Task[], now = Date.now()): Task[] {
  const today = dayKey(new Date(now));
  return tasks
    .filter(
      (t) =>
        !t.deleted_at &&
        (t.status === "planned" || t.status === "in_progress") &&
        (t.schedule === "someday" || (t.schedule === "day" && dayKey(new Date(t.starts_at)) >= today)),
    )
    .sort((a, b) =>
      a.schedule !== b.schedule ? (a.schedule === "day" ? -1 : 1) : a.schedule === "day" ? a.starts_at.localeCompare(b.starts_at) : a.created_at.localeCompare(b.created_at),
    );
}

export function toggleStar(store: PlannerStore, id: string) {
  const t = store.db.tasks[id];
  if (t) store.patch("tasks", id, { starred: !t.starred });
}

// ───────────────────────── 카테고리 ─────────────────────────

export function createCategory(store: PlannerStore, name: string, color: ColorKey): Category {
  const now = nowIso();
  const sort = Math.max(0, ...Object.values(store.db.categories).map((c) => c.sort)) + 1;
  const c: Category = { id: uuid(), name: name.trim(), color, sort, created_at: now, updated_at: now, deleted_at: null };
  store.put("categories", c);
  return c;
}

export function updateCategory(store: PlannerStore, id: string, patch: Partial<Pick<Category, "name" | "color" | "sort">>) {
  store.patch("categories", id, patch);
}

/** 지워도 그 카테고리의 할 일은 남는다(카테고리 없음으로) */
export function deleteCategory(store: PlannerStore, id: string) {
  store.patch("categories", id, { deleted_at: nowIso() });
  for (const t of Object.values(store.db.tasks)) {
    if (t.category_id === id && !t.deleted_at) store.patch("tasks", t.id, { category_id: null });
  }
}

// ───────────────────────── 하루 노트 ─────────────────────────

export function saveDayNote(store: PlannerStore, day: string, patch: { body?: string; mood?: number | null }) {
  const id = dayNoteId(store.userId, day);
  const cur = store.db.day_notes[id];
  const now = nowIso();
  const next: DayNote = {
    id,
    day,
    body: patch.body ?? cur?.body ?? "",
    mood: patch.mood !== undefined ? patch.mood : (cur?.mood ?? null),
    created_at: cur?.created_at ?? now,
    updated_at: now,
    deleted_at: null,
  };
  store.put("day_notes", next);
  return next;
}

export function updateTask(store: PlannerStore, id: string, patch: Partial<Task>) {
  return store.patch("tasks", id, patch);
}

export function startTask(store: PlannerStore, id: string) {
  const t = store.db.tasks[id];
  if (!t || t.status === "in_progress") return;
  const next = store.patch("tasks", id, {
    status: "in_progress",
    started_at: nowIso(),
    completed_at: null,
  });
  log(store, "started", next);
}

export function completeTask(store: PlannerStore, id: string) {
  const t = store.db.tasks[id];
  if (!t || t.status === "done") return;
  const next = store.patch("tasks", id, {
    status: "done",
    started_at: t.started_at ?? nowIso(),
    completed_at: nowIso(),
  });
  log(store, "completed", next);
}

/** '했나요?'에 '했어요' — 체크를 잊은 것뿐이니 그 일정 시간에 한 것으로 기록한다(완료 시각 = 끝 시각) */
export function confirmDone(store: PlannerStore, id: string) {
  const t = store.db.tasks[id];
  if (!t || t.status === "done") return;
  const end = Math.min(Date.parse(t.ends_at), Date.now());
  const next = store.patch("tasks", id, {
    status: "done",
    started_at: t.started_at ?? t.starts_at,
    completed_at: new Date(Number.isFinite(end) ? end : Date.now()).toISOString(),
  });
  log(store, "completed", next, { reason: "나중에 확인: 했어요" });
}

export function reopenTask(store: PlannerStore, id: string) {
  const t = store.db.tasks[id];
  if (!t) return;
  const next = store.patch("tasks", id, {
    status: t.started_at && t.status === "done" ? "in_progress" : "planned",
    completed_at: null,
  });
  log(store, "reopened", next);
}

export function postponeTask(store: PlannerStore, id: string, newStart: Date, reason: string) {
  const t = store.db.tasks[id];
  if (!t) return;
  const dur = Date.parse(t.ends_at) - Date.parse(t.starts_at);
  const next = store.patch("tasks", id, {
    starts_at: newStart.toISOString(),
    ends_at: new Date(newStart.getTime() + dur).toISOString(),
    status: "planned",
    started_at: null,
    postpone_count: t.postpone_count + 1,
  });
  log(store, "postponed", next, {
    reason,
    from_starts_at: t.starts_at,
    to_starts_at: newStart.toISOString(),
  });
}

export function skipTask(store: PlannerStore, id: string, reason: string) {
  const next = store.patch("tasks", id, { status: "skipped" });
  log(store, "skipped", next, { reason });
}

export function markMissed(store: PlannerStore, id: string, reason: string) {
  const next = store.patch("tasks", id, { status: "missed" });
  log(store, "missed", next, { reason });
}

/**
 * 못 한 일정을 새 시각으로 다시 잡는다 — 길이는 그대로, 상태는 다시 '예정'.
 * 놓침·건너뜀 사유는 이미 기록에 남아 있으니 다시 묻지 않는다.
 */
export function rescheduleTask(store: PlannerStore, id: string, newStart: Date) {
  const t = store.db.tasks[id];
  if (!t) return;
  const dur = isTimed(t) ? Date.parse(t.ends_at) - Date.parse(t.starts_at) : 30 * MIN;
  const next = store.patch("tasks", id, {
    schedule: "timed",
    starts_at: newStart.toISOString(),
    ends_at: new Date(newStart.getTime() + dur).toISOString(),
    status: "planned",
    started_at: null,
    completed_at: null,
  });
  log(store, "reopened", next, { from_starts_at: t.starts_at, to_starts_at: newStart.toISOString() });
}

export function deleteTask(store: PlannerStore, id: string) {
  store.patch("tasks", id, { deleted_at: nowIso() });
}

export function restoreTask(store: PlannerStore, id: string) {
  store.patch("tasks", id, { deleted_at: null });
}

/**
 * 끌어서 옮기기. 이미 시작 시각이 지난 미시작 일정을 뒤로 미는 건 '미루기'이므로
 * 사유 없이 처리하지 않고 false 를 돌려준다(화면이 사유 입력을 띄운다).
 */
export function moveTask(store: PlannerStore, id: string, start: Date, end: Date): boolean {
  const t = store.db.tasks[id];
  if (!t) return true;
  const startedAlready = Date.parse(t.starts_at) <= Date.now();
  if (t.status === "planned" && t.strict && startedAlready && start.getTime() > Date.parse(t.starts_at)) {
    return false;
  }
  store.patch("tasks", id, { starts_at: start.toISOString(), ends_at: end.toISOString() });
  return true;
}

// ───────────────────────── 습관 ─────────────────────────

/** 습관 + 날짜 → 결정적 UUID. 서버 materialize_habits() 와 같은 규칙이라 두 쪽이 만들어도 한 행이 된다. */
export function habitInstanceId(habitId: string, day: string): string {
  const hex = habitId.replace(/-/g, "").slice(0, 24) + day.replace(/-/g, "");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface HabitInput {
  title: string;
  color: ColorKey;
  days: number[];
  start_time: string;
  duration_min: number;
  reminder_offsets: number[];
  sound_id: string | null;
  strict: boolean;
}

export function createHabit(store: PlannerStore, input: HabitInput): Habit {
  const now = nowIso();
  const h: Habit = {
    id: uuid(),
    ...input,
    title: input.title.trim(),
    active: true,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  store.put("habits", h);
  materializeHabits(store, [startOfDay(new Date())]);
  return h;
}

/** 습관을 고치면 오늘 이후 아직 시작 안 한 회차도 같이 고친다 */
export function updateHabit(store: PlannerStore, id: string, patch: Partial<Habit>) {
  const h = store.patch("habits", id, patch);
  if (!h) return;
  const today = dayKey(new Date());
  for (const t of Object.values(store.db.tasks)) {
    if (t.habit_id !== id || t.status !== "planned" || t.deleted_at || !t.occurrence_date) continue;
    if (t.occurrence_date < today) continue;
    if (!h.active || h.deleted_at || !h.days.includes(parseDayKey(t.occurrence_date).getDay())) {
      store.patch("tasks", t.id, { deleted_at: nowIso() });
      continue;
    }
    const start = atTime(parseDayKey(t.occurrence_date), h.start_time);
    if (start.getTime() < Date.now()) continue;
    store.patch("tasks", t.id, {
      title: h.title,
      color: h.color,
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + h.duration_min * MIN).toISOString(),
      reminder_offsets: h.reminder_offsets,
      sound_id: h.sound_id,
      strict: h.strict,
    });
  }
  materializeHabits(store, [startOfDay(new Date())]);
}

export function deleteHabit(store: PlannerStore, id: string) {
  updateHabit(store, id, { deleted_at: nowIso(), active: false });
}

/** 보이는 날짜(오늘 이후)에 습관 회차를 만든다. 지난 날짜는 소급하지 않는다. */
export function materializeHabits(store: PlannerStore, days: Date[]) {
  const today = startOfDay(new Date());
  const habits = Object.values(store.db.habits).filter((h) => h.active && !h.deleted_at);
  if (!habits.length) return;
  for (const day of days) {
    if (day < today) continue;
    const key = dayKey(day);
    for (const h of habits) {
      if (!h.days.includes(day.getDay())) continue;
      if (startOfDay(new Date(h.created_at)) > day) continue;
      const id = habitInstanceId(h.id, key);
      if (store.db.tasks[id]) continue;
      const start = atTime(day, h.start_time);
      const created = nowIso();
      const t: Task = {
        id,
        habit_id: h.id,
        occurrence_date: key,
        title: h.title,
        notes: null,
        color: h.color,
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + h.duration_min * MIN).toISOString(),
        status: "planned",
        started_at: null,
        completed_at: null,
        reminder_offsets: h.reminder_offsets,
        sound_id: h.sound_id,
        strict: h.strict,
        postpone_count: 0,
        created_at: created,
        // 자동 생성 회차는 '아주 오래된' 시각 — 다른 기기에서 실제로 고친 내용이 항상 이긴다
        updated_at: new Date(0).toISOString(),
        deleted_at: null,
        schedule: "timed",
        category_id: null,
        starred: false,
      };
      store.put("tasks", t, { mode: "insertIgnore", keepUpdatedAt: true });
    }
  }
}

// ───────────────────────── 집중(뽀모도로) ─────────────────────────

export function startFocus(
  store: PlannerStore,
  settings: Settings,
  opts: { taskId?: string | null; mode?: FocusMode; cycle?: number; minutes?: number } = {},
): FocusSession {
  const cur = activeFocus(store.db);
  if (cur) store.patch("focus_sessions", cur.id, { ended_at: nowIso(), completed: false });
  const mode = opts.mode ?? "focus";
  const cycle = opts.cycle ?? 1;
  const minutes =
    opts.minutes ??
    (mode === "focus"
      ? settings.focusMin
      : cycle % settings.cyclesPerLong === 0
        ? settings.longBreakMin
        : settings.breakMin);
  const now = new Date();
  const f: FocusSession = {
    id: uuid(),
    task_id: opts.taskId ?? null,
    mode,
    started_at: now.toISOString(),
    planned_end: new Date(now.getTime() + minutes * MIN).toISOString(),
    paused_at: null,
    ended_at: null,
    completed: false,
    abandon_reason: null,
    cycle,
    updated_at: now.toISOString(),
    deleted_at: null,
  };
  store.put("focus_sessions", f);
  if (opts.taskId && mode === "focus") startTask(store, opts.taskId);
  return f;
}

export function pauseFocus(store: PlannerStore, id: string) {
  store.patch("focus_sessions", id, { paused_at: nowIso() });
}

export function resumeFocus(store: PlannerStore, id: string) {
  const f = store.db.focus_sessions[id];
  if (!f?.paused_at) return;
  const pausedFor = Date.now() - Date.parse(f.paused_at);
  store.patch("focus_sessions", id, {
    paused_at: null,
    planned_end: new Date(Date.parse(f.planned_end) + pausedFor).toISOString(),
  });
}

export function finishFocus(store: PlannerStore, id: string) {
  const f = store.db.focus_sessions[id];
  if (!f || f.ended_at) return null;
  const next = store.patch("focus_sessions", id, { ended_at: nowIso(), completed: true, paused_at: null });
  if (f.mode === "focus") {
    const task = f.task_id ? store.db.tasks[f.task_id] : null;
    log(store, "focus_done", task ?? null, { title: task?.title ?? "집중 세션" });
  }
  return next;
}

export function abandonFocus(store: PlannerStore, id: string, reason: string) {
  const f = store.db.focus_sessions[id];
  if (!f) return;
  store.patch("focus_sessions", id, { ended_at: nowIso(), completed: false, abandon_reason: reason });
  if (f.mode === "focus") {
    const task = f.task_id ? store.db.tasks[f.task_id] : null;
    log(store, "focus_abandoned", task ?? null, { reason, title: task?.title ?? "집중 세션" });
  }
}

// ───────────────────────── 공부 타이머(열품타 방식) ─────────────────────────

export function liveSubjects(db: DB): Subject[] {
  return Object.values(db.subjects)
    .filter((x) => !x.deleted_at)
    .sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
}

export function liveStudy(db: DB): StudySession[] {
  return Object.values(db.study_sessions).filter((x) => !x.deleted_at);
}

/** 지금 재고 있는 구간(가장 최근 것) */
export function activeStudy(db: DB): StudySession | null {
  return (
    liveStudy(db)
      .filter((x) => !x.ended_at)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null
  );
}

/** 공부 하루의 경계 — dayStartHour(기본 6시)부터 다음날 같은 시각까지. 새벽 공부는 전날로 친다. */
export function studyDayStart(at: Date, dayStartHour: number): Date {
  const d = new Date(at.getFullYear(), at.getMonth(), at.getDate(), dayStartHour);
  return at < d ? addDays(d, -1) : d;
}

/** 구간들 중 [from, to) 에 걸친 부분의 초 — 재는 중인 구간은 now 까지 */
export function studySeconds(sessions: StudySession[], from: number, to: number, now: number): number {
  let ms = 0;
  for (const x of sessions) {
    const s = Math.max(Date.parse(x.started_at), from);
    const e = Math.min(x.ended_at ? Date.parse(x.ended_at) : now, to);
    if (e > s) ms += e - s;
  }
  return Math.floor(ms / 1000);
}

/** 과목별 초 (과목 없음 = "") */
export function studyBySubject(sessions: StudySession[], from: number, to: number, now: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const x of sessions) {
    const sec = studySeconds([x], from, to, now);
    if (sec > 0) out.set(x.subject_id ?? "", (out.get(x.subject_id ?? "") ?? 0) + sec);
  }
  return out;
}

/**
 * 10분 플래너 — 하루를 10분 칸으로 나눠 칸마다 가장 오래 공부한 과목을 칠한다(열품타 타임테이블).
 * 돌려주는 배열 길이 = 144, 값 = 과목 id("" = 과목 없음) 또는 null(공부 안 함)
 */
export function tenMinuteGrid(sessions: StudySession[], dayStart: Date, now: number): (string | null)[] {
  const base = dayStart.getTime();
  const cell = 10 * MIN;
  const best: { id: string | null; ms: number }[] = Array.from({ length: 144 }, () => ({ id: null, ms: 0 }));
  const acc = Array.from({ length: 144 }, () => new Map<string, number>());
  for (const x of sessions) {
    const s = Math.max(Date.parse(x.started_at), base);
    const e = Math.min(x.ended_at ? Date.parse(x.ended_at) : now, base + DAY);
    for (let t = s; t < e; ) {
      const i = Math.floor((t - base) / cell);
      const cellEnd = base + (i + 1) * cell;
      const part = Math.min(e, cellEnd) - t;
      const key = x.subject_id ?? "";
      const m = acc[i];
      m.set(key, (m.get(key) ?? 0) + part);
      if (m.get(key)! > best[i].ms) best[i] = { id: key, ms: m.get(key)! };
      t = cellEnd;
    }
  }
  // 1분도 안 되는 칸은 비워 둔다
  return best.map((b) => (b.ms >= MIN ? b.id : null));
}

const MINE_KEY = "must:study-mine";

/** 이 기기에서 시작한 구간 id — '자리 비우면 멈춤'은 이 기기 것만 멈춘다(다른 기기에서 재는 공부를 끊지 않게) */
export function studyStartedHere(id: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(MINE_KEY) ?? "[]") as string[]).includes(id);
  } catch {
    return false;
  }
}

function rememberMine(id: string) {
  try {
    const list = JSON.parse(localStorage.getItem(MINE_KEY) ?? "[]") as string[];
    localStorage.setItem(MINE_KEY, JSON.stringify([...list.filter((x) => x !== id), id].slice(-20)));
  } catch {
    /* 기록 못 하면 자동 멈춤만 안 된다 */
  }
}

/**
 * 열려 있는 구간을 전부 닫는다 — 두 기기에서 따로 시작한 구간이 동시에 '재는 중'으로 남아 시간이 두 번 쌓이지 않게.
 * 기기 시계가 조금 달라도 끝이 시작보다 앞서지 않게 맞춘다(서버 CHECK 에 걸려 동기화가 통째로 막히지 않게).
 */
function closeOpenStudy(store: PlannerStore, at: Date) {
  for (const x of liveStudy(store.db)) {
    if (x.ended_at) continue;
    const end = Math.max(at.getTime(), Date.parse(x.started_at));
    store.patch("study_sessions", x.id, { ended_at: new Date(end).toISOString() });
  }
}

export function startStudy(store: PlannerStore, subjectId: string | null, taskId: string | null = null): StudySession {
  const now = new Date();
  closeOpenStudy(store, now);
  const iso = now.toISOString();
  const x: StudySession = {
    id: uuid(),
    subject_id: subjectId,
    task_id: taskId,
    started_at: iso,
    ended_at: null,
    created_at: iso,
    updated_at: iso,
    deleted_at: null,
  };
  store.put("study_sessions", x);
  rememberMine(x.id);
  return x;
}

/**
 * 지금 재는 구간을 멈춘다(열린 구간 전부). at 을 주면 그 시각에 그 구간 하나만 멈춘 것으로 — 자리 비움 자동 정지용
 */
export function stopStudy(store: PlannerStore, at?: Date) {
  const cur = activeStudy(store.db);
  if (!cur) return null;
  if (!at) {
    closeOpenStudy(store, new Date());
  } else {
    const end = Math.max(at.getTime(), Date.parse(cur.started_at));
    store.patch("study_sessions", cur.id, { ended_at: new Date(end).toISOString() });
  }
  return store.db.study_sessions[cur.id] ?? null;
}

export function deleteStudySession(store: PlannerStore, id: string) {
  store.patch("study_sessions", id, { deleted_at: nowIso() });
}

export function createSubject(store: PlannerStore, name: string, color: ColorKey): Subject {
  const now = nowIso();
  const sort = Math.max(0, ...Object.values(store.db.subjects).map((x) => x.sort)) + 1;
  const x: Subject = { id: uuid(), name: name.trim(), color, sort, created_at: now, updated_at: now, deleted_at: null };
  store.put("subjects", x);
  return x;
}

export function updateSubject(store: PlannerStore, id: string, patch: Partial<Pick<Subject, "name" | "color" | "sort">>) {
  store.patch("subjects", id, patch);
}

/** 과목을 지워도 공부 기록(시간)은 남는다 */
export function deleteSubject(store: PlannerStore, id: string) {
  const cur = activeStudy(store.db);
  if (cur?.subject_id === id) stopStudy(store);
  store.patch("subjects", id, { deleted_at: nowIso() });
}

// ───────────────────────── 커리어 기록 ─────────────────────────

export function liveCareer(db: DB): CareerEntry[] {
  return Object.values(db.career_entries)
    .filter((x) => !x.deleted_at)
    .sort((a, b) => b.start_day.localeCompare(a.start_day) || b.created_at.localeCompare(a.created_at));
}

export function saveCareer(store: PlannerStore, entry: Omit<CareerEntry, "created_at" | "updated_at" | "deleted_at"> & { created_at?: string }) {
  const now = nowIso();
  const cur = store.db.career_entries[entry.id];
  const row: CareerEntry = { ...entry, created_at: cur?.created_at ?? entry.created_at ?? now, updated_at: now, deleted_at: null };
  store.put("career_entries", row);
  return row;
}

export function deleteCareer(store: PlannerStore, id: string) {
  store.patch("career_entries", id, { deleted_at: nowIso() });
}

export interface CareerItem {
  id: string;
  day: string;
  title: string;
  notes: string | null;
  /** 시각이 있으면 시작 시각(ISO) */
  at: string | null;
  activity: boolean;
}

/** 기간 안에 끝낸 일정·한 일·하루 노트 — AI 가 커리어 문장을 다듬을 재료 */
export function careerMaterial(db: DB, startDay: string, endDay: string) {
  const inRange = (k: string) => k >= startDay && k <= endDay;
  const done: CareerItem[] = Object.values(db.tasks)
    .filter((t) => !t.deleted_at && t.status === "done" && t.completed_at && inRange(dayKey(new Date(t.completed_at))))
    .map((t) => ({
      id: t.id,
      day: dayKey(new Date(t.completed_at!)),
      title: t.title,
      notes: t.notes,
      at: (t.schedule ?? "timed") === "timed" ? t.starts_at : null,
      activity: false,
    }));
  const did: CareerItem[] = liveActivities(db)
    .filter((a) => inRange(a.day))
    .map((a) => ({ id: a.id, day: a.day, title: a.title, notes: a.notes, at: a.starts_at, activity: true }));
  const items = [...done, ...did].sort((a, b) => a.day.localeCompare(b.day) || (a.at ?? "").localeCompare(b.at ?? ""));
  const notes = Object.values(db.day_notes)
    .filter((n) => !n.deleted_at && n.body.trim() && inRange(n.day))
    .sort((a, b) => a.day.localeCompare(b.day));
  return { items, notes };
}

// ───────────────────────── 한 일 기록 ─────────────────────────

export function liveActivities(db: DB): Activity[] {
  return Object.values(db.activities ?? {}).filter((a) => !a.deleted_at);
}

/** 그날 한 일 — 시각 있는 것은 시각 순, 시각 없는 것은 넣은 순으로 뒤에 */
export function activitiesOnDay(list: Activity[], day: string): Activity[] {
  return list
    .filter((a) => a.day === day)
    .sort((a, b) => {
      if (a.starts_at && b.starts_at) return a.starts_at.localeCompare(b.starts_at);
      if (a.starts_at) return -1;
      if (b.starts_at) return 1;
      return a.created_at.localeCompare(b.created_at);
    });
}

/** 한 일의 길이(분). 시각이 없으면 0 */
export const activityMinutes = (a: Activity) =>
  a.starts_at && a.ends_at ? Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / MIN) : 0;

export function saveActivity(store: PlannerStore, input: Omit<Activity, "created_at" | "updated_at" | "deleted_at" | "id"> & { id?: string }) {
  const id = input.id ?? uuid();
  const cur = store.db.activities[id];
  const row: Activity = { ...input, id, created_at: cur?.created_at ?? nowIso(), updated_at: nowIso(), deleted_at: null };
  store.put("activities", row);
  return row;
}

export function deleteActivity(store: PlannerStore, id: string) {
  store.patch("activities", id, { deleted_at: nowIso() });
}

export function weekDays(anchor: Date): Date[] {
  const s = startOfDay(anchor);
  const monday = addDays(s, -((s.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

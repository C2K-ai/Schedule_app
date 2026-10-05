"use client";

import type { PlannerStore } from "./store";
import { addDays, atTime, dayKey, DAY, MIN, nowIso, parseDayKey, startOfDay, uuid } from "./time";
import type {
  ColorKey,
  DB,
  FocusMode,
  FocusSession,
  Habit,
  LogKind,
  Settings,
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

export function tasksOnDay(tasks: Task[], day: Date): Task[] {
  const key = dayKey(day);
  return tasks.filter((t) => dayKey(new Date(t.starts_at)) === key);
}

/** 화면 표시용 파생 상태 */
export type TaskState =
  | "done"
  | "skipped"
  | "missed"
  | "in_progress"
  | "overdue" // 유예 시간도 지났는데 시작 안 함 → 빨간 경고
  | "late" // 시작 시각은 지났지만 유예 시간 안
  | "soon" // 10분 안에 시작
  | "upcoming";

export function taskState(t: Task, now: number, graceMin: number): TaskState {
  if (t.status === "done") return "done";
  if (t.status === "skipped") return "skipped";
  if (t.status === "missed") return "missed";
  if (t.status === "in_progress") return "in_progress";
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
  rate: number;
  focusMin: number;
}

export function dayStats(tasks: Task[], now: number, graceMin: number, focus: FocusSession[] = []): DayStats {
  let done = 0,
    skipped = 0,
    missed = 0,
    inProgress = 0,
    overdue = 0;
  for (const t of tasks) {
    const s = taskState(t, now, graceMin);
    if (s === "done") done++;
    else if (s === "skipped") skipped++;
    else if (s === "missed") missed++;
    else if (s === "in_progress") inProgress++;
    else if (s === "overdue") overdue++;
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
    remaining: total - done - skipped - missed,
    // 건너뛴 것도 '안 한 것' — 분모에서 빼주지 않는다
    rate: total ? Math.round((done / total) * 100) : 0,
    focusMin: Math.round(focusMin),
  };
}

export function currentTask(tasks: Task[], now: number): Task | null {
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
  return tasks.find((t) => t.status === "planned" && Date.parse(t.starts_at) > now) ?? null;
}

/** 강제 대상: 강제 모드 + 아직 planned + 유예 시간 초과 (최근 7일) */
export function enforcementQueue(tasks: Task[], now: number, graceMin: number): Task[] {
  return tasks.filter(
    (t) =>
      t.strict &&
      t.status === "planned" &&
      now >= Date.parse(t.starts_at) + graceMin * MIN &&
      now - Date.parse(t.starts_at) < 7 * DAY,
  );
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
  starts_at: string;
  ends_at: string;
  reminder_offsets?: number[];
  sound_id?: string | null;
  strict?: boolean;
}

export function createTask(store: PlannerStore, input: TaskInput, settings: Settings): Task {
  const now = nowIso();
  const t: Task = {
    id: uuid(),
    habit_id: null,
    occurrence_date: null,
    title: input.title.trim(),
    notes: input.notes ?? null,
    color: input.color ?? "lime",
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    status: "planned",
    started_at: null,
    completed_at: null,
    reminder_offsets: input.reminder_offsets ?? settings.defaultOffsets,
    sound_id: input.sound_id ?? null,
    strict: input.strict ?? true,
    postpone_count: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  store.put("tasks", t);
  return t;
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

export function weekDays(anchor: Date): Date[] {
  const s = startOfDay(anchor);
  const monday = addDays(s, -((s.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** 처음 연 사람을 위한 예시 — 오늘 남은 시간에 일정 몇 개 + 매일 습관 하나 */
export function seedDemo(store: PlannerStore, settings: Settings) {
  const base = Math.ceil(Date.now() / (5 * MIN)) * 5 * MIN;
  const at = (min: number) => new Date(base + min * MIN).toISOString();
  const add = (off: number, dur: number, title: string, color: ColorKey, strict = true) =>
    createTask(store, { title, starts_at: at(off), ends_at: at(off + dur), color, strict }, settings);
  add(15, 30, "독일어 단어 30개", "lime");
  add(60, 45, "운동 — 스쿼트·러닝", "green");
  add(120, 60, "보고서 초안 쓰기", "blue");
  add(200, 20, "내일 계획 세우기", "violet", false);
  createHabit(store, {
    title: "독일어 듣기",
    color: "amber",
    days: [0, 1, 2, 3, 4, 5, 6],
    start_time: "21:00",
    duration_min: 30,
    reminder_offsets: [10, 0],
    sound_id: null,
    strict: true,
  });
}
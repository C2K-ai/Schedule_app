export type TaskStatus = "planned" | "in_progress" | "done" | "skipped" | "missed";

export const COLOR_KEYS = [
  "lime",
  "violet",
  "blue",
  "cyan",
  "green",
  "amber",
  "orange",
  "pink",
  "slate",
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

export const COLOR_HEX: Record<ColorKey, string> = {
  lime: "#C8FF2E",
  violet: "#A78BFA",
  blue: "#60A5FA",
  cyan: "#22D3EE",
  green: "#34D399",
  amber: "#FBBF24",
  orange: "#FB923C",
  pink: "#F472B6",
  slate: "#94A3B8",
};

/** 모든 동기화 대상 행의 공통 필드. updated_at 은 클라이언트 시계(LWW 비교용). */
export interface Row {
  id: string;
  user_id?: string | null;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Task extends Row {
  habit_id: string | null;
  occurrence_date: string | null;
  title: string;
  notes: string | null;
  color: ColorKey;
  starts_at: string;
  ends_at: string;
  status: TaskStatus;
  started_at: string | null;
  completed_at: string | null;
  /** 시작 몇 분 전에 알릴지. 0 = 정각 */
  reminder_offsets: number[];
  sound_id: string | null;
  /** 강제 모드 — 미시작 시 경고 모달 + 사유 입력 */
  strict: boolean;
  postpone_count: number;
  created_at: string;
}

export interface Habit extends Row {
  title: string;
  color: ColorKey;
  /** 0=일 … 6=토 */
  days: number[];
  /** "HH:MM" (기기 현지 시각) */
  start_time: string;
  duration_min: number;
  reminder_offsets: number[];
  sound_id: string | null;
  strict: boolean;
  active: boolean;
  created_at: string;
}

export type LogKind =
  | "started"
  | "completed"
  | "postponed"
  | "skipped"
  | "missed"
  | "reopened"
  | "focus_done"
  | "focus_abandoned";

export interface TaskLog extends Row {
  task_id: string | null;
  kind: LogKind;
  reason: string | null;
  from_starts_at: string | null;
  to_starts_at: string | null;
  /** 기록 당시 일정 제목 — 일정이 지워져도 사유 기록은 읽히게 */
  title: string | null;
  created_at: string;
}

export type FocusMode = "focus" | "break";

export interface FocusSession extends Row {
  task_id: string | null;
  mode: FocusMode;
  started_at: string;
  planned_end: string;
  paused_at: string | null;
  ended_at: string | null;
  completed: boolean;
  abandon_reason: string | null;
  cycle: number;
}

export type Wave = "sine" | "square" | "triangle" | "sawtooth" | "bell" | "pluck";

export interface SoundDef {
  id: string;
  name: string;
  emoji: string;
  wave: Wave;
  bpm: number;
  /** MIDI 기준음 */
  root: number;
  /** 스텝별 반음 오프셋. null = 쉼표 */
  steps: (number | null)[];
  /** 스텝 길이 대비 음 길이 0.1~1 */
  gate: number;
  /** 다음 음으로 미끄러지듯 이어짐(사이렌) */
  glide: boolean;
  builtin?: boolean;
  /** 녹음된 음원 파일(/sounds/*.mp3). 있으면 합성 대신 이 파일을 재생한다 */
  src?: string;
}

export type VibrationKey = "none" | "short" | "double" | "heartbeat" | "sos" | "alarm";
export type AlarmTheme = "pulse" | "strobe" | "calm";
export type AlarmKind = "before" | "start" | "overdue" | "end" | "snooze" | "focus";

export interface Settings {
  graceMin: number;
  defaultOffsets: number[];
  reasonMinLength: number;
  postponeWarnAt: number;
  sounds: { before: string; start: string; overdue: string; focus: string };
  volume: number;
  escalate: boolean;
  speak: boolean;
  vibration: VibrationKey;
  alarmTheme: AlarmTheme;
  focusMin: number;
  breakMin: number;
  longBreakMin: number;
  cyclesPerLong: number;
  autoStartBreak: boolean;
  dayStartHour: number;
  customSounds: SoundDef[];
  theme: "system" | "dark" | "light";
}

export interface Profile {
  id: string;
  timezone: string;
  grace_min: number;
  settings: Partial<Settings>;
  updated_at: string;
}

export type TableName = "tasks" | "habits" | "task_logs" | "focus_sessions";

export interface DB {
  tasks: Record<string, Task>;
  habits: Record<string, Habit>;
  task_logs: Record<string, TaskLog>;
  focus_sessions: Record<string, FocusSession>;
  profile: Profile | null;
}

export interface SyncStatus {
  mode: "local" | "cloud";
  online: boolean;
  pending: number;
  lastSyncAt: string | null;
  realtime: "off" | "connecting" | "live";
  error: string | null;
}

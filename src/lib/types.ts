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
  /** timed = 시각 지정(알림·강제 대상) / day = 날짜만 / someday = 날짜 없음 */
  schedule: ScheduleKind;
  category_id: string | null;
  starred: boolean;
}

export type ScheduleKind = "timed" | "day" | "someday";

export interface Category extends Row {
  name: string;
  color: ColorKey;
  sort: number;
  created_at: string;
}

/** 캘린더 하루 노트 — 그날 할 것·생각·느낌 */
export interface DayNote extends Row {
  /** YYYY-MM-DD (현지 날짜) */
  day: string;
  body: string;
  /** 1(별로) ~ 5(최고), 없으면 null */
  mood: number | null;
  created_at: string;
}

/** 공부 타이머 과목(열품타 방식) */
export interface Subject extends Row {
  name: string;
  color: ColorKey;
  sort: number;
  created_at: string;
}

/** 스톱워치 한 구간. ended_at 이 null 이면 지금 재는 중 */
export interface StudySession extends Row {
  subject_id: string | null;
  task_id: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

export type CareerKind = "work" | "project" | "study" | "cert" | "award" | "activity" | "etc";

/** 커리어 기록 — raw 는 내가 적은 것, polished 는 AI 가 다듬은 것(고칠 수 있음) */
export interface CareerEntry extends Row {
  title: string;
  kind: CareerKind;
  /** YYYY-MM-DD */
  start_day: string;
  end_day: string | null;
  raw: string;
  polished: string;
  skills: string[];
  task_ids: string[];
  created_at: string;
}

export interface DDay {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
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
  /** dusk = 사진 배경 테마(기본, 늘 어두움) / lime·ocean·cherry·lavender = 단색 테마(밝게·어둡게) — lib/palettes.ts */
  palette: "dusk" | "lime" | "ocean" | "cherry" | "lavender";
  /** 노을 그네 테마의 배경 그림·사진(lib/backgrounds.ts 의 key) */
  background: string;
  /** PC 에 설치한 앱은 켠 뒤 처음 클릭할 때 전체 화면으로(브라우저 규칙상 클릭 한 번이 필요) */
  pcFullscreen: boolean;
  /** 앱이 켜질 때(노트북 부팅 후 자동 실행 포함) 오늘 브리핑 알림 */
  launchBriefing: boolean;
  /** 폰 잠금화면에 '지금/다음 일정' 카드(소리 없는 알림)를 띄워 둔다 — 안드로이드 */
  lockCard: boolean;
  /** 하루 공부 목표(분) */
  studyGoalMin: number;
  /** 공부 중 다른 앱·탭으로 가면 자동 일시정지(열품타의 집중 잠금 대신) */
  studyAutoPause: boolean;
  ddays: DDay[];
}

export interface Profile {
  id: string;
  timezone: string;
  grace_min: number;
  settings: Partial<Settings>;
  updated_at: string;
}

export type TableName =
  | "tasks"
  | "habits"
  | "task_logs"
  | "focus_sessions"
  | "categories"
  | "day_notes"
  | "subjects"
  | "study_sessions"
  | "career_entries";

export interface DB {
  tasks: Record<string, Task>;
  habits: Record<string, Habit>;
  task_logs: Record<string, TaskLog>;
  focus_sessions: Record<string, FocusSession>;
  categories: Record<string, Category>;
  day_notes: Record<string, DayNote>;
  subjects: Record<string, Subject>;
  study_sessions: Record<string, StudySession>;
  career_entries: Record<string, CareerEntry>;
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

import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  graceMin: 5,
  defaultOffsets: [10, 0],
  reasonMinLength: 10,
  postponeWarnAt: 2,
  // 기본은 듣기 편한 녹음 음원(CC0). 합성음(사이렌 등)은 원하면 고른다
  sounds: { before: "glass-ping", start: "steel-rise", overdue: "hit-alert", focus: "steel-calm" },
  volume: 0.8,
  escalate: true,
  speak: true,
  vibration: "heartbeat",
  alarmTheme: "pulse",
  focusMin: 25,
  breakMin: 5,
  longBreakMin: 15,
  cyclesPerLong: 4,
  autoStartBreak: true,
  dayStartHour: 6,
  customSounds: [],
  theme: "system",
  palette: "dusk",
  background: "swing",
  pcFullscreen: true,
  launchBriefing: true,
  // 잠금화면 카드는 원하는 사람만 켠다(기본 꺼짐)
  lockCard: false,
  studyGoalMin: 360,
  studyAutoPause: true,
  ddays: [],
};

export function mergeSettings(partial: Partial<Settings> | null | undefined): Settings {
  const p = partial ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...p,
    sounds: { ...DEFAULT_SETTINGS.sounds, ...(p.sounds ?? {}) },
    customSounds: p.customSounds ?? [],
    ddays: p.ddays ?? [],
  };
}

export const OFFSET_CHOICES = [0, 5, 10, 15, 30, 60];
export const DURATION_CHOICES = [15, 30, 45, 60, 90, 120];

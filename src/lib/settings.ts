import type { AlarmMode, Settings, VibrationKey } from "./types";

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
  alarmMode: "sound",
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
  // 2026-10-10 사용자: 열품타처럼 잡지 말고 나가 있어도 계속 재기 → 기본 꺼짐(예전 키 studyAutoPause 는 버림)
  studyAwayStop: false,
  ddays: [],
  // 일기 책 효과음 — 조용한 게 기본
  diarySound: false,
};

export function mergeSettings(partial: Partial<Settings> | null | undefined): Settings {
  const p = partial ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...p,
    sounds: { ...DEFAULT_SETTINGS.sounds, ...(p.sounds ?? {}) },
    customSounds: p.customSounds ?? [],
    ddays: p.ddays ?? [],
    alarmMode: ALARM_MODES.includes(p.alarmMode as AlarmMode) ? (p.alarmMode as AlarmMode) : "sound",
  };
}

export const ALARM_MODES: AlarmMode[] = ["sound", "vibrate", "silent"];

/**
 * 알람 방식에 따라 실제로 낼 것.
 *  · sound: 소리 + (켜 두었으면) 제목 읽어 주기 + 진동 패턴
 *  · vibrate: 소리·읽어 주기 없이 진동(진동 패턴이 '없음'이면 기본 패턴) + 화면 깜빡임
 *  · silent: 소리·읽어 주기·진동 없이 화면만 깜빡임
 */
export function alarmOutput(s: Pick<Settings, "alarmMode" | "speak" | "vibration">): {
  sound: boolean;
  voice: boolean;
  vibration: VibrationKey;
  flash: boolean;
} {
  const mode = s.alarmMode ?? "sound";
  return {
    sound: mode === "sound",
    voice: mode === "sound" && s.speak,
    vibration: mode === "silent" ? "none" : mode === "vibrate" && s.vibration === "none" ? "heartbeat" : s.vibration,
    flash: mode !== "sound",
  };
}

export const OFFSET_CHOICES = [0, 5, 10, 15, 30, 60];
export const DURATION_CHOICES = [15, 30, 45, 60, 90, 120];

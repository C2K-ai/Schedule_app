import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  graceMin: 5,
  defaultOffsets: [10, 0],
  reasonMinLength: 10,
  postponeWarnAt: 2,
  sounds: { before: "chime", start: "digital", overdue: "siren", focus: "zen" },
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
};

export function mergeSettings(partial: Partial<Settings> | null | undefined): Settings {
  const p = partial ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...p,
    sounds: { ...DEFAULT_SETTINGS.sounds, ...(p.sounds ?? {}) },
    customSounds: p.customSounds ?? [],
  };
}

export const OFFSET_CHOICES = [0, 5, 10, 15, 30, 60];
export const DURATION_CHOICES = [15, 30, 45, 60, 90, 120];

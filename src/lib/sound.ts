"use client";

import type { SoundDef, VibrationKey, Wave } from "./types";

/**
 * 자체 알람 소리 엔진.
 *  - 음원: Kenney.nl 의 CC0(퍼블릭 도메인) 징글·효과음을 다듬은 MP3 (public/sounds)
 *  - 합성: Web Audio 로 만드는 프리셋, 그리고 사운드 스튜디오에서 사용자가 찍은 패턴
 * 둘 다 같은 SoundDef 로 표현된다(src 가 있으면 음원).
 * 앱이 열려 있으면(백그라운드 탭 포함) 이 소리가 나고, 닫혀 있으면 OS 푸시의 시스템 소리가 난다.
 */

const sample = (id: string, name: string, emoji: string): SoundDef => ({
  id,
  name,
  emoji,
  src: `/sounds/${id}.mp3`,
  // 아래 값은 합성용 — 음원에서는 쓰지 않는다
  wave: "sine",
  bpm: 120,
  root: 60,
  steps: [],
  gate: 1,
  glide: false,
  builtin: true,
});

/** 녹음 음원 — 듣기 좋은 순서로. 기본값은 정각=스틸드럼 아침, 사전=유리 종, 미시작=타악 경고 */
export const SAMPLE_SOUNDS: SoundDef[] = [
  sample("steel-rise", "스틸드럼 · 아침", "🌅"),
  sample("steel-bright", "스틸드럼 · 경쾌", "🏝️"),
  sample("steel-calm", "스틸드럼 · 잔잔", "🌊"),
  sample("steel-bell", "스틸드럼 · 한 번", "🔔"),
  sample("glass-ping", "유리 종", "🥂"),
  sample("glass-duo", "유리 · 짧게", "💎"),
  sample("pizzi-up", "피치카토 · 상승", "🎻"),
  sample("pizzi-walk", "피치카토 · 산책", "🚶"),
  sample("pizzi-hop", "피치카토 · 통통", "🐇"),
  sample("sax-smooth", "색소폰 · 부드럽게", "🎷"),
  sample("sax-lift", "색소폰 · 올라가기", "🌇"),
  sample("retro-up", "8비트 · 레벨업", "🍄"),
  sample("retro-fanfare", "8비트 · 팡파르", "🏆"),
  sample("retro-quest", "8비트 · 퀘스트", "🗺️"),
  sample("confirm-up", "확인음 · 상승", "✅"),
  sample("confirm-soft", "확인음 · 짧게", "☑️"),
  sample("maximize-up", "스윕 · 위로", "⬆️"),
  sample("switch-up", "스위치", "🔘"),
  sample("hit-alert", "타악 · 경고", "🥁"),
  sample("hit-drive", "타악 · 몰아치기", "⚡"),
];

export const SYNTH_SOUNDS: SoundDef[] = [
  {
    id: "chime",
    name: "맑은 차임",
    emoji: "🔔",
    wave: "bell",
    bpm: 200,
    root: 72,
    steps: [0, 4, 7, 12, null, null, null, null],
    gate: 0.9,
    glide: false,
    builtin: true,
  },
  {
    id: "digital",
    name: "디지털 비프",
    emoji: "⌚",
    wave: "square",
    bpm: 560,
    root: 93,
    steps: [0, null, 0, null, 0, null, 0, null, null, null, null, null, null, null, null, null],
    gate: 0.8,
    glide: false,
    builtin: true,
  },
  {
    id: "siren",
    name: "경보 사이렌",
    emoji: "🚨",
    wave: "sawtooth",
    bpm: 90,
    root: 69,
    steps: [0, 7, 0, 7],
    gate: 1,
    glide: true,
    builtin: true,
  },
  {
    id: "heartbeat",
    name: "심장박동",
    emoji: "🫀",
    wave: "sine",
    bpm: 300,
    root: 40,
    steps: [0, null, 0, null, null, null, null, null, null, null],
    gate: 0.9,
    glide: false,
    builtin: true,
  },
  {
    id: "retro",
    name: "레트로 게임",
    emoji: "👾",
    wave: "square",
    bpm: 480,
    root: 72,
    steps: [0, 4, 7, 12, 16, 19, 24, null, 24, null, null, null],
    gate: 0.7,
    glide: false,
    builtin: true,
  },
  {
    id: "marimba",
    name: "마림바",
    emoji: "🪵",
    wave: "pluck",
    bpm: 300,
    root: 67,
    steps: [0, 7, 12, 7, 9, null, 5, null, null, null],
    gate: 0.6,
    glide: false,
    builtin: true,
  },
  {
    id: "rise",
    name: "상승 경고",
    emoji: "📈",
    wave: "triangle",
    bpm: 420,
    root: 60,
    steps: [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24, null],
    gate: 0.75,
    glide: false,
    builtin: true,
  },
  {
    id: "zen",
    name: "명상 종",
    emoji: "🧘",
    wave: "bell",
    bpm: 40,
    root: 57,
    steps: [0, null, 7, null],
    gate: 1,
    glide: false,
    builtin: true,
  },
];

export const BUILTIN_SOUNDS: SoundDef[] = [...SAMPLE_SOUNDS, ...SYNTH_SOUNDS];

export const STUDIO_SCALE = [0, 2, 4, 7, 9, 12, 14, 16]; // 펜타토닉 8음 (아래→위)

export const VIBRATIONS: Record<VibrationKey, { label: string; pattern: number[] }> = {
  none: { label: "끄기", pattern: [] },
  short: { label: "짧게", pattern: [150] },
  double: { label: "두 번", pattern: [120, 80, 120] },
  heartbeat: { label: "심장박동", pattern: [90, 90, 90, 500, 90, 90, 90] },
  sos: {
    label: "SOS",
    pattern: [100, 60, 100, 60, 100, 200, 300, 60, 300, 60, 300, 200, 100, 60, 100, 60, 100],
  },
  alarm: { label: "긴 경보", pattern: [600, 200, 600, 200, 600, 200, 600] },
};

export function findSound(id: string | null | undefined, custom: SoundDef[]): SoundDef {
  return (
    custom.find((s) => s.id === id) ??
    BUILTIN_SOUNDS.find((s) => s.id === id) ??
    BUILTIN_SOUNDS[0]
  );
}

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

let ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** 첫 사용자 제스처에서 호출 — 이후 백그라운드에서도 소리를 낼 수 있게 오디오를 깨워 둔다. */
export function unlockAudio() {
  const c = getAudioContext();
  if (!c) return;
  // iOS: 무음 스위치를 무시하고 재생되도록 (Safari 16.4+)
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) {
    try {
      nav.audioSession.type = "playback";
    } catch {
      /* 지원 안 함 */
    }
  }
  if (c.state === "suspended") void c.resume();
  // 무음 버퍼 한 번 — 일부 모바일 브라우저의 잠금 해제 조건
  const buf = c.createBuffer(1, 1, 22050);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  src.start(0);
}

export function audioUnlocked(): boolean {
  return ctx?.state === "running";
}

interface Voice {
  stop: (t: number) => void;
}

function playVoice(
  c: BaseAudioContext,
  dest: AudioNode,
  wave: Wave,
  freq: number,
  t: number,
  dur: number,
  vol: number,
  glideTo: number | null,
): Voice {
  const out = c.createGain();
  out.connect(dest);
  const oscs: OscillatorNode[] = [];

  const addOsc = (type: OscillatorType, ratio: number, gain: number, decay: number | null) => {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq * ratio, t);
    if (glideTo) o.frequency.linearRampToValueAtTime(glideTo * ratio, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    if (decay) g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + Math.max(dur, decay ?? 0) + 0.1);
    oscs.push(o);
  };

  if (wave === "bell") {
    // 비정수배 배음 — 금속성 종소리
    const len = Math.max(dur, 1.2);
    addOsc("sine", 1, 0.6, len);
    addOsc("sine", 2.0, 0.25, len * 0.7);
    addOsc("sine", 2.76, 0.18, len * 0.5);
    addOsc("sine", 5.4, 0.08, len * 0.3);
    out.gain.setValueAtTime(vol, t);
  } else if (wave === "pluck") {
    addOsc("triangle", 1, 0.8, 0.35);
    addOsc("sine", 4, 0.15, 0.08);
    out.gain.setValueAtTime(vol, t);
  } else {
    addOsc(wave, 1, wave === "sine" ? 0.9 : 0.35, null);
    const end = t + dur;
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    out.gain.setValueAtTime(vol, Math.max(t + 0.01, end - 0.03));
    out.gain.exponentialRampToValueAtTime(0.0001, end);
  }

  return {
    stop: (when: number) => {
      oscs.forEach((o) => {
        try {
          o.stop(when);
        } catch {
          /* 이미 멈춤 */
        }
      });
    },
  };
}

/** 한 바퀴를 t 시점부터 예약. 반환값 = 한 바퀴 길이(초) */
function schedulePass(
  c: BaseAudioContext,
  dest: AudioNode,
  def: SoundDef,
  t0: number,
  vol: number,
  speed: number,
  voices: Voice[],
): number {
  const stepDur = 60 / (def.bpm * speed);
  def.steps.forEach((st, i) => {
    if (st === null) return;
    const t = t0 + i * stepDur;
    let glideTo: number | null = null;
    if (def.glide) {
      const next = def.steps[(i + 1) % def.steps.length];
      if (next !== null && next !== undefined) glideTo = midiToHz(def.root + next);
    }
    voices.push(
      playVoice(c, dest, def.wave, midiToHz(def.root + st), t, stepDur * def.gate, vol, glideTo),
    );
  });
  return def.steps.length * stepDur;
}

// ───────────── 음원(샘플) 로딩 ─────────────
const sampleCache = new Map<string, Promise<AudioBuffer | null>>();

export function loadSample(src: string): Promise<AudioBuffer | null> {
  const c = getAudioContext();
  if (!c) return Promise.resolve(null);
  let p = sampleCache.get(src);
  if (!p) {
    p = fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((b) => c.decodeAudioData(b))
      .catch((e) => {
        console.warn("[must] 음원 로드 실패", src, e);
        sampleCache.delete(src);
        return null;
      });
    sampleCache.set(src, p);
  }
  return p;
}

/** 알람이 울릴 때 네트워크를 기다리지 않도록 미리 받아 둔다(서비스 워커가 오프라인용으로도 캐시) */
export function preloadSounds(defs: SoundDef[]) {
  for (const d of defs) if (d.src) void loadSample(d.src);
}

export interface PlayOptions {
  volume?: number;
  /** 반복 재생(알람) — 멈출 때까지 */
  loop?: boolean;
  /** 반복될수록 커지고 간격이 좁아짐 */
  escalate?: boolean;
  maxSeconds?: number;
  onEnd?: () => void;
}

export interface PlayHandle {
  stop: () => void;
}

/** 한 바퀴를 t 시점에 예약하고 그 길이(초)를 돌려준다 */
type PassFn = (c: BaseAudioContext, dest: AudioNode, t: number, pass: number, voices: Voice[]) => number;
/** 바퀴 사이 쉬는 시간 */
type GapFn = (len: number, pass: number, escalate: boolean) => number;

const synthPass =
  (def: SoundDef): PassFn =>
  (c, dest, t, pass, voices) =>
    schedulePass(c, dest, def, t, 0.5, 1, voices);

const synthGap: GapFn = (len, pass, escalate) => Math.min(0.6, len * 0.25) * (escalate ? Math.max(0.4, 1 - pass * 0.06) : 1);

const samplePass =
  (buf: AudioBuffer): PassFn =>
  (c, dest, t, _pass, voices) => {
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = 0.9;
    src.connect(g);
    g.connect(dest);
    src.start(t);
    voices.push({
      stop: (when) => {
        try {
          src.stop(when);
        } catch {
          /* 이미 멈춤 */
        }
      },
    });
    return buf.duration;
  };

const sampleGap: GapFn = (len, pass, escalate) =>
  Math.max(0.25, Math.min(0.9, len * 0.6)) * (escalate ? Math.max(0.35, 1 - pass * 0.07) : 1);

let current: PlayHandle | null = null;

export function stopAllSounds() {
  current?.stop();
  current = null;
}

/**
 * 반복 알람은 최대 길이만큼 미리 한꺼번에 예약한다.
 * 백그라운드 탭에서 타이머가 1분 단위로 늦춰져도 소리는 끊기지 않는다.
 */
function scheduleLoop(c: AudioContext, opts: PlayOptions, pass: PassFn, gap: GapFn, onEnd: () => void): PlayHandle {
  const volume = Math.max(0, Math.min(1, opts.volume ?? 0.8));
  const master = c.createGain();
  master.connect(c.destination);
  const voices: Voice[] = [];
  const start = c.currentTime + 0.05;
  const maxSec = opts.loop ? (opts.maxSeconds ?? 30) : 30;

  let t = start;
  let n = 0;
  do {
    const len = pass(c, master, t, n, voices);
    t += len + (opts.loop ? gap(len, n, Boolean(opts.escalate)) : 0);
    n++;
  } while (opts.loop && t - start < maxSec);

  const end = t;
  if (opts.escalate) {
    master.gain.setValueAtTime(volume * 0.4, start);
    master.gain.linearRampToValueAtTime(volume, start + Math.min(20, end - start));
  } else {
    master.gain.setValueAtTime(volume, start);
  }

  let stopped = false;
  const timer = window.setTimeout(
    () => {
      if (!stopped) {
        stopped = true;
        onEnd();
      }
    },
    (end - c.currentTime) * 1000 + 300,
  );

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      window.clearTimeout(timer);
      const now = c.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + 0.08);
      voices.forEach((v) => v.stop(now + 0.1));
      window.setTimeout(() => master.disconnect(), 200);
      onEnd();
    },
  };
}

export function playSound(def: SoundDef, opts: PlayOptions = {}): PlayHandle {
  const c = getAudioContext();
  if (!c) return { stop() {} };
  if (c.state === "suspended") void c.resume();
  stopAllSounds();

  let inner: PlayHandle | null = null;
  let cancelled = false;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    opts.onEnd?.();
  };
  const outer: PlayHandle = {
    stop() {
      cancelled = true;
      if (inner) inner.stop();
      else end();
    },
  };
  current = outer;

  if (def.src) {
    void loadSample(def.src).then((buf) => {
      if (cancelled || current !== outer) return;
      inner = buf
        ? scheduleLoop(c, opts, samplePass(buf), sampleGap, end)
        : scheduleLoop(c, opts, synthPass(SYNTH_SOUNDS[0]), synthGap, end); // 파일을 못 읽으면 합성음으로 대신
    });
  } else {
    inner = scheduleLoop(c, opts, synthPass(def), synthGap, end);
  }
  return outer;
}
/** 일정 제목을 소리 내어 읽기 */
export function speak(text: string, volume = 1) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  u.rate = 1.05;
  u.volume = volume;
  const ko = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith("ko"));
  if (ko) u.voice = ko;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export function vibrate(key: VibrationKey) {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  const p = VIBRATIONS[key]?.pattern ?? [];
  if (p.length) navigator.vibrate(p);
}

/**
 * 사운드를 WAV 파일로 렌더 — 안드로이드에서는 이 파일을 앱(사이트) 알림 채널의 소리로 지정할 수 있다.
 * 그러면 앱이 닫혀 있을 때 오는 푸시도 내가 만든 소리로 울린다.
 */
export async function renderWav(def: SoundDef, passes = 2): Promise<Blob> {
  const sampleRate = 44100;
  if (def.src) {
    const buf = await loadSample(def.src);
    if (!buf) throw new Error("음원을 읽지 못했습니다");
    const gapSec = sampleGap(buf.duration, 0, false);
    const off = new OfflineAudioContext(1, Math.ceil((buf.duration * passes + gapSec * (passes - 1) + 0.1) * sampleRate), sampleRate);
    const voices: Voice[] = [];
    let t = 0;
    for (let i = 0; i < passes; i++) t += samplePass(buf)(off, off.destination, t, i, voices) + gapSec;
    return encodeWav(await off.startRendering());
  }
  const stepDur = 60 / def.bpm;
  const passLen = def.steps.length * stepDur;
  const tail = def.wave === "bell" ? 1.5 : 0.5;
  const length = Math.ceil((passLen * passes + tail) * sampleRate);
  const off = new OfflineAudioContext(1, length, sampleRate);
  const master = off.createGain();
  master.gain.value = 0.9;
  master.connect(off.destination);
  const voices: Voice[] = [];
  let t = 0;
  for (let i = 0; i < passes; i++) t += schedulePass(off, master, def, t, 0.5, 1, voices);
  const buf = await off.startRendering();
  return encodeWav(buf);
}

function encodeWav(buf: AudioBuffer): Blob {
  const data = buf.getChannelData(0);
  const bytes = 44 + data.length * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const w = (o: number, s: string) => [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)));
  w(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  w(8, "WAVE");
  w(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buf.sampleRate, true);
  view.setUint32(28, buf.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  w(36, "data");
  view.setUint32(40, data.length * 2, true);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  const norm = peak > 0 ? 0.95 / peak : 1;
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i] * norm));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}

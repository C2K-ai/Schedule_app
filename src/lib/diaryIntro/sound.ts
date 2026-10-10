// 책 효과음 — 파일 없이 WebAudio 로 만든다. sound 가 켜졌을 때만 엔진이 부른다.
// 만든 소리 마디는 모두 모아 두었다가 stop() 에서 끄고, close() 에서 오디오 장치까지 닫는다.

import { lerp, mulberry32 } from "./math";
import { CLOSE, OPEN, type LeafPlan } from "./timeline";

export type SoundKind = "open" | "close" | "chime";

export interface Voice {
  /** 소리를 fade 초 동안 줄이고 모든 마디를 멈춘다 */
  stop(fade?: number): void;
  /** stop + 오디오 장치 닫기(되돌릴 수 없음) */
  close(fade?: number): void;
}

type ACtor = new () => AudioContext;

function audioCtor(win: Window): ACtor | null {
  const w = win as unknown as { AudioContext?: ACtor; webkitAudioContext?: ACtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** 소리 재생 시작. 실패하면(지원 안 함 등) null */
export function startSound(win: Window, kind: SoundKind, leaves: LeafPlan | null): Voice | null {
  const AC = audioCtor(win);
  if (!AC) return null;
  let ctx: AudioContext;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const sources: AudioScheduledSourceNode[] = [];
  const T0 = ctx.currentTime + 0.03;
  const at = (ms: number) => T0 + ms / 1000;
  const R = mulberry32(kind === "close" ? 5151 : 4242);
  const volume = 0.55;
  const master = ctx.createGain();
  master.gain.value = volume;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 3.5;
  comp.attack.value = 0.003;
  comp.release.value = 0.22;
  master.connect(comp);
  comp.connect(ctx.destination);

  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  {
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = R() * 2 - 1;
  }
  const noise = (when: number, dur: number, offset = 0) => {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.start(when, offset % 1.5, dur);
    sources.push(s);
    return s;
  };
  const osc = (type: OscillatorType, f: number, when: number, dur: number) => {
    const n = ctx.createOscillator();
    n.type = type;
    n.frequency.value = f;
    n.start(when);
    n.stop(when + dur);
    sources.push(n);
    return n;
  };
  const filt = (type: BiquadFilterType, f: number, q = 0.7) => {
    const n = ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    return n;
  };
  const env = (when: number, peak: number, a: number, d: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + a);
    g.gain.exponentialRampToValueAtTime(0.0001, when + a + d);
    return g;
  };
  const chain = (...n: AudioNode[]): AudioNode => {
    for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]);
    return n[n.length - 1];
  };
  const panner = (v: number): StereoPannerNode | null => {
    if (typeof ctx.createStereoPanner !== "function") return null;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, v));
    return p;
  };
  // 종소리에 작은 방 울림
  const room = ctx.createDelay(1);
  room.delayTime.value = 0.15;
  const fb = ctx.createGain();
  fb.gain.value = 0.36;
  const wet = ctx.createGain();
  wet.gain.value = 0.45;
  const tone = filt("lowpass", 5600, 0.5);
  chain(room, tone, fb, room);
  tone.connect(wet);
  wet.connect(master);
  const bell = (f: number, when: number, peak: number, dur: number, pan = 0) => {
    const p = panner(pan);
    for (const [mul, amp] of [
      [1, 1],
      [2.76, 0.22],
      [5.4, 0.06],
    ]) {
      const g = env(when, peak * amp, 0.008, dur * (mul === 1 ? 1 : 0.5));
      chain(osc("sine", f * mul, when, dur + 0.1), g);
      if (p) g.connect(p);
      else {
        g.connect(master);
        g.connect(room);
      }
    }
    if (p) {
      p.connect(master);
      p.connect(room);
    }
  };
  /** 공기 가르는 소리(띠 잡음, 주파수가 미끄러진다) */
  const swish = (t0: number, t1: number, f0: number, f1: number, peak: number, off: number, q = 0.8) => {
    const bp = filt("bandpass", f0, q);
    bp.frequency.setValueAtTime(f0, t0);
    bp.frequency.exponentialRampToValueAtTime(f1, t1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (t1 - t0) * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.05);
    chain(noise(t0, t1 - t0 + 0.08, off), bp, g, master);
  };
  /** 툭 — 표지·책이 내려앉는 소리 */
  const thump = (t: number, f: number, peak: number, dur: number) => {
    const n = osc("sine", f, t, dur + 0.12);
    n.frequency.setValueAtTime(f, t);
    n.frequency.exponentialRampToValueAtTime(f * 0.38, t + dur * 0.6);
    chain(n, env(t, peak, 0.005, dur), master);
    chain(noise(t, 0.12, 0.9), filt("lowpass", 520, 0.7), env(t, peak * 0.45, 0.002, 0.09), master);
  };

  // 촤라락: 장마다 틱 세 번, 오른쪽 → 왼쪽으로 지나간다 + 그 사이 사각거림
  const riffle = (rs: readonly [number, number]) => {
    if (leaves) {
      leaves.starts.forEach((s, i) => {
        const pan = lerp(0.32, -0.32, i / Math.max(1, leaves.n - 1));
        for (const [frac, amp] of [
          [0.12, 0.12],
          [0.5, 0.22],
          [0.86, 0.16],
        ]) {
          const when = at(s + leaves.durs[i] * frac + (R() - 0.5) * 12);
          const p = panner(pan + (frac - 0.5) * 0.25);
          const g = env(when, amp * (0.8 + R() * 0.4) * (0.55 + 0.45 * Math.sin((Math.PI * (i + 0.5)) / leaves.n)), 0.0025, 0.022 + R() * 0.03);
          const tail = chain(noise(when, 0.08, R() * 1.4), filt("bandpass", 2200 + R() * 2800, 0.9 + R() * 0.5), g);
          if (p) chain(tail, p, master);
          else tail.connect(master);
        }
      });
    }
    const s0 = at(rs[0]), s1 = at(rs[1]);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, s0);
    g.gain.exponentialRampToValueAtTime(0.03, (s0 + s1) / 2);
    g.gain.exponentialRampToValueAtTime(0.0001, s1);
    chain(noise(s0, s1 - s0 + 0.05, 0.5), filt("highpass", 2400, 0.6), g, master);
  };

  if (kind === "chime") {
    // 움직임 줄이기: 부드러운 세 음만
    [1318.5, 1975.5, 2637.0].forEach((f, i) => bell(f, at(30 + i * 70), 0.03, 0.9, (i - 1) * 0.2));
  } else if (kind === "open") {
    swish(at(OPEN.cover[0]), at(OPEN.cover[1]), 320, 1500, 0.075, 0.3);
    thump(at(OPEN.cover[1]), 118, 0.72, 0.3);
    riffle(OPEN.riffle);
    // 빛이 터질 때: 종 아르페지오 + 따뜻한 화음 + 반짝이는 공기
    {
      const ts = at(OPEN.burst[0] + 30);
      [1318.5, 1661.2, 1975.5, 2489.0, 2637.0, 3322.4, 3951.1].forEach((f, i) =>
        bell(f, ts + i * 0.062 + R() * 0.01, 0.026 * (1 - i * 0.07), 1.2 - i * 0.06, lerp(-0.3, 0.3, i / 6)),
      );
      [329.6, 493.9].forEach((f) => {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, ts);
        g.gain.exponentialRampToValueAtTime(0.03, ts + 0.35);
        g.gain.exponentialRampToValueAtTime(0.0001, ts + 1.6);
        chain(osc("triangle", f, ts, 1.7), filt("lowpass", 1400), g, master);
      });
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ts);
      g.gain.exponentialRampToValueAtTime(0.028, ts + 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, ts + 1.3);
      chain(noise(ts, 1.4, 0.2), filt("highpass", 6800, 0.6), g, master);
    }
    // 종이가 들려 나온다: 휙 + 날짜가 뜰 때 작은 종
    swish(at(OPEN.lift[0] + 60), at(OPEN.sheet[1]), 700, 2600, 0.045, 0.7, 0.6);
    bell(1975.5, at(OPEN.text[0] - 120), 0.018, 0.75, 0.1);
    bell(2637.0, at(OPEN.text[0] - 50), 0.012, 0.7, -0.1);
  } else {
    // 덮기: 종이가 접혀 들어감 → 남은 장 촤라락 → 뒷표지가 덮이며 툭 → DIARY 에 작은 종
    swish(at(CLOSE.shrink[0]), at(CLOSE.unlift[0] + 80), 2400, 700, 0.04, 0.6, 0.6);
    {
      const when = at(CLOSE.unlift[1] - 40);
      chain(noise(when, 0.08, 1.1), filt("bandpass", 3200, 1.1), env(when, 0.08, 0.003, 0.05), master);
    }
    riffle(CLOSE.riffle);
    swish(at(CLOSE.back[0]), at(CLOSE.back[1]), 1400, 320, 0.07, 0.3);
    thump(at(CLOSE.back[1]), 104, 0.72, 0.28);
    bell(1318.5, at(CLOSE.sheen[0] + 20), 0.016, 0.6, -0.1);
    bell(987.8, at(CLOSE.sheen[0] + 100), 0.013, 0.6, 0.1);
  }

  let stopped = false;
  let closed = false;
  const halt = () => {
    for (const n of sources) {
      try {
        n.stop();
      } catch {
        /* 이미 멈춤 */
      }
    }
    try {
      master.disconnect();
      wet.disconnect();
      room.disconnect();
    } catch {
      /* 이미 끊김 */
    }
  };
  const stop = (fade = 0.12) => {
    if (stopped) return;
    stopped = true;
    try {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + fade);
    } catch {
      /* 닫힌 장치 */
    }
    win.setTimeout(halt, fade * 1000 + 40);
  };
  return {
    stop,
    close(fade = 0.12) {
      if (closed) return;
      closed = true;
      stop(fade);
      win.setTimeout(() => {
        halt();
        ctx.close().catch(() => {});
      }, fade * 1000 + 60);
    },
  };
}

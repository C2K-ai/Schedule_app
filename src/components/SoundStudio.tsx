"use client";

import { Copy, Dice5, Download, Play, Plus, Square, Trash } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { downloadSound, getAudioContext, playSound, SAMPLE_SOUNDS, STUDIO_SCALE, stopAllSounds, SYNTH_SOUNDS, type PlayHandle } from "@/lib/sound";
import { uuid } from "@/lib/time";
import type { SoundDef, Wave } from "@/lib/types";
import { usePlanner } from "./PlannerProvider";
import { Button, Chip, cx, inputCls, Label, Switch } from "./ui";

const WAVES: { value: Wave; label: string }[] = [
  { value: "sine", label: "사인 · 부드럽게" },
  { value: "triangle", label: "삼각 · 맑게" },
  { value: "square", label: "사각 · 8비트" },
  { value: "sawtooth", label: "톱니 · 거칠게" },
  { value: "bell", label: "종" },
  { value: "pluck", label: "마림바" },
];

const ROOTS = [
  { midi: 48, name: "낮은 도 (C3)" },
  { midi: 55, name: "낮은 솔 (G3)" },
  { midi: 60, name: "도 (C4)" },
  { midi: 67, name: "솔 (G4)" },
  { midi: 72, name: "높은 도 (C5)" },
  { midi: 79, name: "높은 솔 (G5)" },
  { midi: 84, name: "아주 높은 도 (C6)" },
];

const EMOJIS = ["🎵", "🔔", "⚡", "🚀", "🐓", "🎺", "🥁", "💥", "🌊", "🧨", "🦉", "🎯"];

const nearestRow = (v: number) => {
  let best = 0;
  STUDIO_SCALE.forEach((s, i) => {
    if (Math.abs(s - v) < Math.abs(STUDIO_SCALE[best] - v)) best = i;
  });
  return best;
};

function randomPattern(len: number): (number | null)[] {
  const out: (number | null)[] = [];
  let row = Math.floor(Math.random() * 4);
  for (let i = 0; i < len; i++) {
    if (Math.random() < (i % 4 === 0 ? 0.15 : 0.35)) {
      out.push(null);
      continue;
    }
    row = Math.max(0, Math.min(STUDIO_SCALE.length - 1, row + Math.round((Math.random() - 0.45) * 3)));
    out.push(STUDIO_SCALE[row]);
  }
  out[0] = out[0] ?? STUDIO_SCALE[2];
  return out;
}

function blank(): SoundDef {
  return {
    id: `custom-${uuid().slice(0, 8)}`,
    name: "내 알람",
    emoji: "🎵",
    wave: "triangle",
    bpm: 360,
    root: 72,
    steps: [0, null, 4, null, 7, null, 12, null, 7, null, 12, null, 16, null, null, null],
    gate: 0.7,
    glide: false,
  };
}

export function SoundStudio() {
  const { settings, updateSettings, toast } = usePlanner();
  const [draft, setDraft] = useState<SoundDef>(() => settings.customSounds[0] ?? blank());
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const handle = useRef<PlayHandle | null>(null);
  const raf = useRef<number | null>(null);
  const saved = settings.customSounds.some((s) => s.id === draft.id);

  useEffect(
    () => () => {
      handle.current?.stop();
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    [],
  );

  const stop = () => {
    handle.current?.stop();
    handle.current = null;
    if (raf.current) cancelAnimationFrame(raf.current);
    setPlaying(false);
    setPlayhead(null);
  };

  const play = (def: SoundDef = draft, loop = true) => {
    stop();
    const ctx = getAudioContext();
    const t0 = (ctx?.currentTime ?? 0) + 0.05;
    handle.current = playSound(def, { volume: settings.volume, loop, maxSeconds: 8, onEnd: () => stop() });
    setPlaying(true);
    if (def.src) return; // 녹음 음원은 스텝 표시가 없다
    const stepDur = 60 / def.bpm;
    const passLen = def.steps.length * stepDur;
    const gap = loop ? Math.min(0.6, passLen * 0.25) : 0;
    const tick = () => {
      if (!ctx) return;
      const el = ctx.currentTime - t0;
      const inPass = el % (passLen + gap);
      setPlayhead(inPass < passLen ? Math.floor(inPass / stepDur) : null);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const set = (p: Partial<SoundDef>) => setDraft((d) => ({ ...d, ...p }));

  const toggleCell = (step: number, row: number) => {
    const v = STUDIO_SCALE[row];
    const steps = [...draft.steps];
    steps[step] = steps[step] !== null && nearestRow(steps[step]!) === row ? null : v;
    set({ steps });
  };

  const setLength = (n: number) => {
    const steps = Array.from({ length: n }, (_, i) => draft.steps[i] ?? null);
    set({ steps });
  };

  const save = () => {
    const list = settings.customSounds.filter((s) => s.id !== draft.id);
    updateSettings({ customSounds: [...list, { ...draft, builtin: false }] });
    toast({ text: `${draft.emoji} '${draft.name}' 저장 — 일정·알림 종류에서 고를 수 있어요`, tone: "ok" });
  };

  const remove = () => {
    updateSettings({ customSounds: settings.customSounds.filter((s) => s.id !== draft.id) });
    setDraft(settings.customSounds.find((s) => s.id !== draft.id) ?? blank());
  };

  const exportWav = () => void downloadSound(draft);

  return (
    <div className="space-y-5">
      {/* 사운드 목록 */}
      {(
        [
          { title: "녹음 음원", hint: "Kenney.nl CC0 · 눌러서 듣기", list: SAMPLE_SOUNDS },
          { title: "합성음", hint: "Web Audio로 그 자리에서 만든 소리", list: SYNTH_SOUNDS },
          { title: "내 사운드", hint: "아래 스튜디오에서 만든 것", list: settings.customSounds },
        ] as const
      )
        .filter((g) => g.list.length > 0)
        .map((g) => (
          <div key={g.title}>
            <Label hint={g.hint}>{g.title}</Label>
            <div className="flex flex-wrap gap-1.5">
              {g.list.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    play(s, false);
                    if (!s.builtin) setDraft(s);
                  }}
                  className={cx(
                    "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-semibold transition",
                    draft.id === s.id ? "border-accent bg-accent/15" : "border-line bg-surface-2 hover:border-line-strong",
                  )}
                >
                  <span>{s.emoji}</span> {s.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      <div className="rounded-3xl border border-line bg-surface-2/50 p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            value={draft.emoji}
            onChange={(e) => set({ emoji: e.target.value })}
            className="h-10 rounded-xl border border-line bg-surface px-2 text-lg"
            aria-label="이모지"
          >
            {EMOJIS.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} className={cx(inputCls, "h-10 max-w-[220px] py-1")} />
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => set({ steps: randomPattern(draft.steps.length) })}>
              <Dice5 size={15} /> 랜덤
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(blank())}>
              <Plus size={15} /> 새로
            </Button>
            {SYNTH_SOUNDS.length > 0 && (
              <select
                className="h-8 rounded-xl border border-line bg-surface px-2 text-[13px] font-semibold text-muted"
                value=""
                onChange={(e) => {
                  const b = SYNTH_SOUNDS.find((x) => x.id === e.target.value);
                  if (b) setDraft({ ...b, id: `custom-${uuid().slice(0, 8)}`, name: `${b.name} 변형`, builtin: false });
                }}
                aria-label="프리셋 복제"
              >
                <option value="">프리셋 복제…</option>
                {SYNTH_SOUNDS.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.emoji} {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* 스텝 시퀀서 */}
        <div className="overflow-x-auto pb-1">
          <div
            className="grid min-w-[520px] gap-1"
            style={{ gridTemplateColumns: `repeat(${draft.steps.length}, minmax(0, 1fr))` }}
          >
            {[...STUDIO_SCALE].reverse().map((_, ri) => {
              const row = STUDIO_SCALE.length - 1 - ri;
              return draft.steps.map((v, si) => {
                const on = v !== null && nearestRow(v) === row;
                const head = playhead === si;
                return (
                  <button
                    key={`${row}-${si}`}
                    onClick={() => toggleCell(si, row)}
                    aria-label={`${si + 1}번째 스텝 ${row + 1}번째 음`}
                    className={cx(
                      "h-7 rounded-md transition",
                      on
                        ? head
                          ? "scale-110 bg-fg"
                          : "bg-accent shadow-[0_0_12px_-2px_var(--accent)]"
                        : head
                          ? "bg-surface-3"
                          : si % 4 === 0
                            ? "bg-surface-3/80 hover:bg-line-strong"
                            : "bg-surface hover:bg-surface-3",
                    )}
                  />
                );
              });
            })}
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <Label>음색</Label>
            <div className="flex flex-wrap gap-1.5">
              {WAVES.map((w) => (
                <Chip key={w.value} active={draft.wave === w.value} onClick={() => set({ wave: w.value })}>
                  {w.label}
                </Chip>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <Label hint={`${draft.bpm} BPM`}>빠르기</Label>
              <input
                type="range"
                min={40}
                max={720}
                step={10}
                value={draft.bpm}
                onChange={(e) => set({ bpm: Number(e.target.value) })}
                className="w-full accent-[var(--accent)]"
              />
            </div>
            <div>
              <Label hint={`${Math.round(draft.gate * 100)}%`}>음 길이</Label>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={draft.gate}
                onChange={(e) => set({ gate: Number(e.target.value) })}
                className="w-full accent-[var(--accent)]"
              />
            </div>
          </div>
          <div>
            <Label>기준음</Label>
            <select value={draft.root} onChange={(e) => set({ root: Number(e.target.value) })} className={cx(inputCls, "h-10 py-1")}>
              {ROOTS.map((r) => (
                <option key={r.midi} value={r.midi}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>스텝 수</Label>
            <div className="flex gap-1.5">
              {[8, 12, 16].map((n) => (
                <Chip key={n} active={draft.steps.length === n} onClick={() => setLength(n)}>
                  {n}
                </Chip>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-2">
          <Switch checked={draft.glide} onChange={(glide) => set({ glide })} label="글라이드" desc="음과 음 사이를 미끄러지듯 이어서 사이렌처럼" />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {playing ? (
            <Button
              variant="soft"
              onClick={() => {
                stop();
                stopAllSounds();
              }}
            >
              <Square size={15} /> 정지
            </Button>
          ) : (
            <Button variant="soft" onClick={() => play()}>
              <Play size={15} /> 미리듣기
            </Button>
          )}
          <Button variant="primary" onClick={save}>
            {saved ? "저장" : "내 사운드로 저장"}
          </Button>
          <Button variant="ghost" onClick={exportWav} title="안드로이드 알림 소리로 지정할 수 있는 WAV 파일">
            <Download size={15} /> WAV
          </Button>
          {saved && (
            <>
              <Button variant="ghost" onClick={() => setDraft({ ...draft, id: `custom-${uuid().slice(0, 8)}`, name: `${draft.name} 사본` })}>
                <Copy size={15} /> 복제
              </Button>
              <Button variant="ghost" className="text-danger" onClick={remove}>
                <Trash size={15} /> 삭제
              </Button>
            </>
          )}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          앱이 열려 있으면(백그라운드 탭 포함) 이 소리로 울립니다. 앱이 닫혀 있을 때 오는 푸시는 OS 알림음이 나는데,
          안드로이드는 <b>WAV로 내보낸 뒤</b> 설정 → 앱 → DREAM(또는 Chrome) → 알림 → 소리에서 이 파일을 고르면 닫혀
          있어도 내 소리로 울립니다.
        </p>
      </div>
    </div>
  );
}

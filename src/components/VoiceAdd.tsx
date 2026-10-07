"use client";

import { Check, Loader2, Mic, MicOff, Repeat, Sparkles, Star, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { parseSchedule, saveParsed, type ParsedItem } from "@/lib/ai";
import { liveCategories } from "@/lib/planner";
import { speechSupported, useSpeech } from "@/lib/speech";
import { getSupabase } from "@/lib/supabase";
import { atTime, dayKey, parseDayKey, WEEKDAYS } from "@/lib/time";
import { COLOR_HEX, type ScheduleKind } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { usePlanner } from "./PlannerProvider";
import { Button, cx, inputCls, Modal, Segmented } from "./ui";

type Draft = ParsedItem & { key: number; on: boolean };

const KIND_OPTIONS: { value: ScheduleKind; label: string }[] = [
  { value: "timed", label: "시간" },
  { value: "day", label: "날짜만" },
  { value: "someday", label: "언젠가" },
];

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

const fmtDays = (days: number[]) =>
  days.length === 7
    ? "매일"
    : days.join() === "1,2,3,4,5"
      ? "평일마다"
      : days.join() === "0,6"
        ? "주말마다"
        : `매주 ${[...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAYS[d]).join("·")}`;

/** 말로(또는 대충 적어서) 일정 넣기 — 듣기 → AI 정리 → 미리보기에서 고치고 → 추가 */
export function VoiceAdd() {
  const { sheet } = usePlanner();
  if (sheet !== "voice") return null;
  return <VoiceBody />;
}

function VoiceBody() {
  const { openSheet, store, settings, snap, session, toast } = usePlanner();
  const categories = useMemo(() => liveCategories(snap.db), [snap.db]);
  const [text, setText] = useState("");
  const { listening, error: micError, start, stop } = useSpeech(setText);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [canSpeak] = useState(speechSupported);
  const close = () => openSheet(null);

  // 열자마자 듣기 시작 — 버튼을 누른 그 손짓으로 열렸으니 브라우저가 마이크를 허락한다
  useEffect(() => {
    if (canSpeak) start("");
  }, [canSpeak, start]);

  const analyze = async () => {
    stop();
    const t = text.trim();
    if (!t) return setErr("할 일을 말하거나 적어 주세요");
    const sb = getSupabase();
    if (!sb || !session.userId) return setErr("AI 정리는 로그인한 상태에서만 쓸 수 있어요 (설정 → 계정).");
    setErr(null);
    setBusy(true);
    try {
      const r = await parseSchedule(sb, t, categories);
      setReply(r.reply);
      if (r.items.length) setDrafts(r.items.map((it, i) => ({ ...it, key: i, on: true })));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chosen = drafts?.filter((d) => d.on && d.title.trim()) ?? [];
  const save = () => {
    if (!chosen.length) return;
    const r = saveParsed(store, chosen.map((d) => ({ ...d, title: d.title.trim() })), settings, categories);
    const parts = [r.tasks && `일정 ${r.tasks}개`, r.habits && `습관 ${r.habits}개`].filter(Boolean).join(" · ");
    toast({ text: `✓ ${parts} 추가했어요`, tone: "ok" });
    close();
  };

  const patch = (key: number, p: Partial<Draft>) =>
    setDrafts((list) => list?.map((d) => (d.key === key ? { ...d, ...p } : d)) ?? null);

  if (drafts) {
    return (
      <Modal
        open
        onClose={close}
        title="이렇게 넣을까요?"
        subtitle={reply ?? undefined}
        footer={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => (setDrafts(null), setReply(null))}>
              <Mic size={16} /> 다시 말하기
            </Button>
            <Button variant="primary" className="ml-auto" disabled={!chosen.length} onClick={save}>
              <Check size={16} /> {chosen.length}개 추가
            </Button>
          </div>
        }
      >
        <ul className="space-y-3">
          {drafts.map((d) => (
            <DraftCard key={d.key} d={d} categories={categories} onChange={(p) => patch(d.key, p)} />
          ))}
        </ul>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={close}
      title="말로 일정 추가"
      subtitle="생각나는 대로 말하세요. AI 가 날짜·시간·반복을 알아서 정리합니다."
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={close}>
            취소
          </Button>
          <Button variant="primary" className="ml-auto" disabled={busy || !text.trim()} onClick={analyze}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy ? "정리하는 중…" : "AI로 정리"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {canSpeak && (
          <div className="flex flex-col items-center gap-2 py-2">
            <button
              type="button"
              aria-label={listening ? "듣기 멈추기" : "말하기 시작"}
              onClick={() => (listening ? stop() : start(text))}
              className={cx(
                "relative grid size-20 place-items-center rounded-full transition active:scale-95",
                listening ? "bg-danger text-white" : "bg-accent text-accent-fg",
              )}
            >
              {listening && <span className="ring-wave absolute inset-0 rounded-full bg-danger/50" />}
              {listening ? <MicOff size={30} className="relative" /> : <Mic size={30} />}
            </button>
            <p className="text-xs text-muted">{listening ? "듣는 중… 다 말했으면 눌러서 멈추기" : "눌러서 말하기"}</p>
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void analyze();
          }}
          rows={canSpeak ? 4 : 6}
          placeholder="예: 내일 오후 세 시에 치과 가고, 금요일까지 보고서 내야 해. 그리고 매일 아침 일곱 시에 운동 삼십 분. 언젠가 책장 정리."
          className={cx(inputCls, "resize-none leading-relaxed")}
        />
        {!canSpeak && (
          <p className="text-xs text-muted">
            이 브라우저는 음성 인식을 지원하지 않아요. 키보드의 🎤(받아쓰기)로 말하거나 직접 적어 주세요.
          </p>
        )}
        {reply && !err && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm">{reply}</p>}
        {(err || micError) && (
          <p className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            {err ?? micError}
          </p>
        )}
      </div>
    </Modal>
  );
}

function DraftCard({
  d,
  categories,
  onChange,
}: {
  d: Draft;
  categories: { id: string; name: string; color: keyof typeof COLOR_HEX }[];
  onChange: (p: Partial<Draft>) => void;
}) {
  const now = useNow(30_000);
  const repeating = d.repeat_days.length > 0;
  const past = !repeating && d.kind === "timed" && d.date && d.start && atTime(parseDayKey(d.date), d.start).getTime() < now;
  return (
    <li className={cx("rounded-2xl border border-line bg-surface-2/60 p-3 transition", !d.on && "opacity-45")}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={d.on ? "빼기" : "넣기"}
          onClick={() => onChange({ on: !d.on })}
          className={cx(
            "grid size-6 shrink-0 place-items-center rounded-lg border-2 transition",
            d.on ? "border-accent bg-accent text-accent-fg" : "border-line-strong",
          )}
        >
          {d.on && <Check size={14} strokeWidth={3} />}
        </button>
        <input
          value={d.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none"
          aria-label="제목"
        />
        <button
          type="button"
          aria-label="별표"
          onClick={() => onChange({ starred: !d.starred })}
          className={cx("grid size-8 place-items-center rounded-lg", d.starred ? "text-warn" : "text-faint hover:text-muted")}
        >
          <Star size={18} fill={d.starred ? "currentColor" : "none"} />
        </button>
      </div>

      {d.on && (
        <div className="mt-2.5 space-y-2 pl-8">
          {repeating ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1 rounded-lg bg-accent/15 px-2 py-1 font-semibold text-accent-text">
                <Repeat size={13} /> {fmtDays(d.repeat_days)} 습관
              </span>
              <input
                type="time"
                value={d.start ?? "09:00"}
                onChange={(e) => e.target.value && onChange({ start: e.target.value })}
                className={cx(inputCls, "h-9 w-auto! py-1 text-sm")}
              />
              <button
                type="button"
                onClick={() => onChange({ repeat_days: [] })}
                className="inline-flex items-center gap-0.5 text-xs text-muted hover:text-fg"
              >
                <X size={12} /> 반복 빼기
              </button>
            </div>
          ) : (
            <>
              <Segmented
                value={d.kind}
                onChange={(kind) =>
                  onChange({
                    kind,
                    date: kind === "someday" ? null : (d.date ?? dayKey(new Date())),
                    start: kind === "timed" ? (d.start ?? "09:00") : d.start,
                  })
                }
                options={KIND_OPTIONS}
              />
              {d.kind !== "someday" && (
                <div className="flex flex-wrap gap-2">
                  <input
                    type="date"
                    value={d.date ?? ""}
                    onChange={(e) => e.target.value && onChange({ date: e.target.value })}
                    className={cx(inputCls, "h-9 w-auto! py-1 text-sm")}
                  />
                  {d.kind === "timed" && (
                    <>
                      <input
                        type="time"
                        value={d.start ?? "09:00"}
                        onChange={(e) => e.target.value && onChange({ start: e.target.value })}
                        className={cx(inputCls, "h-9 w-auto! py-1 text-sm")}
                      />
                      <select
                        value={d.duration_min ?? 30}
                        onChange={(e) => onChange({ duration_min: Number(e.target.value) })}
                        className={cx(inputCls, "h-9 w-auto! py-1 text-sm")}
                        aria-label="길이"
                      >
                        {[...new Set([...DURATIONS, d.duration_min ?? 30])]
                          .sort((a, b) => a - b)
                          .map((m) => (
                            <option key={m} value={m}>
                              {m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}`}
                            </option>
                          ))}
                      </select>
                    </>
                  )}
                </div>
              )}
              {past && <p className="text-xs font-semibold text-warn">이미 지난 시각이에요 — 날짜나 시간을 확인하세요.</p>}
            </>
          )}
          {!repeating && categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onChange({ category_id: d.category_id === c.id ? null : c.id })}
                  className={cx(
                    "inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs font-semibold transition",
                    d.category_id === c.id ? "border-transparent bg-fg text-bg" : "border-line text-muted hover:text-fg",
                  )}
                >
                  <span className="size-2 rounded-full" style={{ background: COLOR_HEX[c.color] }} />
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {d.notes && <p className="text-xs text-muted">메모: {d.notes}</p>}
        </div>
      )}
    </li>
  );
}

"use client";

import { Check, ImagePlus, Loader2, Sparkles, TriangleAlert, X } from "lucide-react";
import { useRef, useState } from "react";
import { parseTimetable, type ParsedClass } from "@/lib/ai";
import { shrinkPhoto, type Photo } from "@/lib/photo";
import { createHabit } from "@/lib/planner";
import { getSupabase } from "@/lib/supabase";
import { colorFor, isSameClass, periodText, toHHMM, toMin, type Semester } from "@/lib/timetable";
import { WEEKDAYS } from "@/lib/time";
import type { ColorKey, Habit } from "@/lib/types";
import { usePlanner } from "./PlannerProvider";
import { Button, cx, inputCls, Label, Modal } from "./ui";

type Draft = { key: number; on: boolean; dup: boolean; title: string; place: string; days: number[]; start: string; end: string };

/**
 * 시간표 사진으로 넣기 — 에브리타임·학교 포털 캡처, 종이 시간표 사진, 학원 시간표(또는 글로 적은 목록).
 * 학기 기간을 정하고 → AI 가 읽고 → 미리보기에서 고친 뒤 → 학기 동안 매주 반복되는 수업으로 넣는다(강제 모드 끔)
 */
export function TimetableImport({
  sem,
  existing,
  onClose,
  onSaved,
}: {
  sem: Semester;
  /** 지금 보는 학기의 수업 — 이미 있는 건 처음에 빼 둔다 */
  existing: Habit[];
  onClose: () => void;
  /** 넣은 학기 key(start~end) */
  onSaved: (key: string) => void;
}) {
  const { store, settings, session } = usePlanner();
  const [range, setRange] = useState<Semester>(sem);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    try {
      setPhoto(await shrinkPhoto(f));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "사진을 읽지 못했어요.");
    }
  };

  const read = async () => {
    if (busy) return;
    const sb = getSupabase();
    if (!sb || !session.userId) return setErr("사진 읽기는 로그인한 상태에서만 쓸 수 있어요 (설정 → 계정). 수업은 '수업' 버튼으로 직접 넣을 수 있어요.");
    if (!photo && !text.trim()) return setErr("시간표 사진을 고르거나 시간표를 글로 적어 주세요.");
    if (!range.start || !range.end || range.end < range.start) return setErr("학기 기간(개강 ~ 종강)을 확인해 주세요.");
    setBusy(true);
    setErr(null);
    try {
      const r = await parseTimetable(sb, { image: photo ?? undefined, text: text.trim() });
      setReply(r.reply || null);
      if (!r.classes.length) return setErr(r.reply || "시간표에서 수업을 찾지 못했어요. 더 또렷한 사진으로 해 보세요.");
      setDrafts(r.classes.map((c, i) => toDraft(c, i, existing, range)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "시간표를 읽지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const chosen = drafts?.filter((d) => d.on) ?? [];
  const bad = chosen.find((d) => !d.title.trim() || !d.days.length || toMin(d.end) - toMin(d.start) < 5);
  const save = () => {
    if (!chosen.length || bad) return;
    const colors = new Map<string, ColorKey>(existing.map((h) => [h.title.trim(), h.color]));
    for (const d of chosen) {
      createHabit(store, {
        title: d.title.trim(),
        place: d.place.trim().slice(0, 60) || null,
        color: colorFor(d.title, colors),
        days: [...d.days].sort(),
        start_time: d.start,
        duration_min: toMin(d.end) - toMin(d.start),
        reminder_offsets: settings.defaultOffsets,
        sound_id: null,
        strict: false,
        start_day: range.start,
        end_day: range.end,
        in_timetable: true,
      });
    }
    onSaved(`${range.start}~${range.end}`);
  };
  const patch = (key: number, p: Partial<Draft>) => setDrafts((l) => l?.map((d) => (d.key === key ? { ...d, ...p } : d)) ?? null);

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      size="lg"
      title="시간표 사진으로 넣기"
      subtitle={drafts ? `${periodText(range.start, range.end)} 동안 매주 반복돼요. 틀린 건 고치고 넣으세요.` : "에브리타임·학교 포털 캡처, 종이 시간표 사진, 학원 시간표 다 돼요."}
      footer={
        drafts ? (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => (setDrafts(null), setReply(null))}>
              다시 하기
            </Button>
            <Button variant="primary" className="ml-auto" disabled={!chosen.length || Boolean(bad)} onClick={save}>
              <Check size={16} /> {chosen.length}개 넣기
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              닫기
            </Button>
            <Button variant="primary" className="ml-auto" disabled={busy || (!photo && !text.trim())} onClick={() => void read()}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {busy ? "읽는 중… (10~30초)" : "읽기"}
            </Button>
          </div>
        )
      }
    >
      {drafts ? (
        <div className="space-y-3">
          {reply && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm">{reply}</p>}
          {bad && <p className="text-sm font-semibold text-danger">이름·요일·시각(끝이 시작보다 뒤)을 확인해 주세요 — &apos;{bad.title || "이름 없음"}&apos;</p>}
          <ul className="space-y-2">
            {drafts.map((d) => (
              <li key={d.key} className={cx("rounded-2xl border border-line bg-surface-2/60 p-3 transition", !d.on && "opacity-45")}>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={d.on ? "빼기" : "넣기"}
                    onClick={() => patch(d.key, { on: !d.on })}
                    className={cx("grid size-6 shrink-0 place-items-center rounded-lg border-2 transition", d.on ? "border-accent bg-accent text-accent-fg" : "border-line-strong")}
                  >
                    {d.on && <Check size={14} strokeWidth={3} />}
                  </button>
                  <input value={d.title} onChange={(e) => patch(d.key, { title: e.target.value })} aria-label="과목 이름" className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none" />
                  {d.dup && <span className="shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] font-semibold text-muted">이미 있어요</span>}
                </div>
                {d.on && (
                  <div className="mt-2.5 space-y-2 pl-8">
                    <DayPicker size="sm" value={d.days} onChange={(days) => patch(d.key, { days })} />
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
                      <input type="time" value={d.start} onChange={(e) => e.target.value && patch(d.key, { start: e.target.value })} aria-label="시작" className={cx(inputCls, "h-9 py-1 text-sm")} />
                      <span className="text-sm text-muted">~</span>
                      <input type="time" value={d.end} onChange={(e) => e.target.value && patch(d.key, { end: e.target.value })} aria-label="끝" className={cx(inputCls, "h-9 py-1 text-sm")} />
                    </div>
                    <input value={d.place} onChange={(e) => patch(d.key, { place: e.target.value })} placeholder="강의실 (없으면 비워 두기)" aria-label="강의실" maxLength={60} className={cx(inputCls, "h-9 py-1 text-sm")} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
          {photo ? (
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- 기기 안 미리보기(data URL) */}
              <img src={photo.preview} alt="시간표 사진" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
              <p className="min-w-0 flex-1 text-sm text-muted">이 사진에서 수업을 읽어요. 시간이 잘 보이게 찍힌 사진일수록 정확해요.</p>
              <button type="button" aria-label="사진 빼기" onClick={() => setPhoto(null)} className="rounded-lg p-1.5 text-muted hover:bg-surface-3">
                <X size={16} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-1.5 rounded-2xl border-2 border-dashed border-line px-4 py-7 text-center transition hover:border-accent hover:bg-accent/5"
            >
              <ImagePlus size={26} className="text-accent-text" />
              <span className="font-semibold">시간표 사진 고르기</span>
              <span className="text-xs text-muted">캡처·사진 한 장 — 수업 칸이 다 보이게</span>
            </button>
          )}
          <div>
            <Label hint="없어도 돼요">덧붙일 말 · 또는 시간표를 글로</Label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={"예: 1교시는 9시 시작, 50분 수업이야\n또는: 자료구조 월수 10:30-11:45 공학관 301"}
              className={cx(inputCls, "resize-none leading-relaxed")}
            />
          </div>
          <div>
            <Label>학기 기간 — 이 동안 매주 반복돼요</Label>
            <PeriodInputs value={range} onChange={setRange} />
          </div>
          {err && (
            <p className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              {err}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function toDraft(c: ParsedClass, key: number, existing: Habit[], sem: Semester): Draft {
  const dup = existing.some((h) => isSameClass(h, { title: c.title, start: c.start, days: c.days }, sem));
  return { key, on: !dup, dup, title: c.title, place: c.place ?? "", days: c.days, start: c.start, end: toHHMM(toMin(c.start) + c.duration_min) };
}

const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function PeriodInputs({ value, onChange }: { value: Semester; onChange: (v: Semester) => void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      <input type="date" value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} aria-label="개강" className={cx(inputCls, "px-2.5")} />
      <span className="text-sm text-muted">~</span>
      <input type="date" value={value.end} min={value.start || undefined} onChange={(e) => onChange({ ...value, end: e.target.value })} aria-label="종강" className={cx(inputCls, "px-2.5")} />
    </div>
  );
}

export function DayPicker({ value, onChange, size = "md" }: { value: number[]; onChange: (v: number[]) => void; size?: "sm" | "md" }) {
  return (
    <div className="flex gap-1">
      {ORDER.map((x) => (
        <button
          key={x}
          type="button"
          aria-pressed={value.includes(x)}
          onClick={() => onChange(value.includes(x) ? value.filter((y) => y !== x) : [...value, x])}
          className={cx(
            "rounded-lg font-bold transition",
            size === "sm" ? "size-8 text-xs" : "size-10 text-sm",
            value.includes(x) ? "bg-accent text-accent-fg" : "bg-surface-3 text-muted",
          )}
        >
          {WEEKDAYS[x]}
        </button>
      ))}
    </div>
  );
}

"use client";

import { Flame, Pause, Pencil, Play, Plus, Repeat, Trash } from "lucide-react";
import { useMemo, useState } from "react";
import { createHabit, deleteHabit, habitStreak, updateHabit, type HabitInput } from "@/lib/planner";
import { DURATION_CHOICES, OFFSET_CHOICES } from "@/lib/settings";
import { SoundOptions } from "./SoundOptions";
import { addDays, dayKey, fmtOffset, startOfDay, WEEKDAYS } from "@/lib/time";
import { COLOR_HEX, type Habit } from "@/lib/types";
import { usePlanner } from "./PlannerProvider";
import { Button, Chip, ColorPicker, cx, Empty, inputCls, Label, Modal, Switch } from "./ui";

const ORDER = [1, 2, 3, 4, 5, 6, 0];

/** '~10/31까지', '10/12~10/31' */
function habitRangeLabel(h: Habit): string {
  const md = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;
  return h.start_day && h.end_day ? `${md(h.start_day)}~${md(h.end_day)}` : h.end_day ? `~${md(h.end_day)}까지` : "";
}

function HabitForm({ initial, onDone }: { initial: Habit | null; onDone: () => void }) {
  const { store, settings } = usePlanner();
  const [f, setF] = useState<HabitInput>(
    initial
      ? {
          title: initial.title,
          color: initial.color,
          days: initial.days,
          start_time: initial.start_time,
          duration_min: initial.duration_min,
          reminder_offsets: initial.reminder_offsets,
          sound_id: initial.sound_id,
          strict: initial.strict,
          start_day: initial.start_day ?? null,
          end_day: initial.end_day ?? null,
        }
      : {
          title: "",
          color: "violet",
          days: [1, 2, 3, 4, 5],
          start_time: "07:00",
          duration_min: 30,
          reminder_offsets: settings.defaultOffsets,
          sound_id: null,
          strict: true,
        },
  );
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<HabitInput>) => setF({ ...f, ...p });

  const save = () => {
    if (!f.title.trim()) return setErr("이름을 적어 주세요");
    if (!f.days.length) return setErr("요일을 하나 이상 고르세요");
    if (f.start_day && f.end_day && f.end_day < f.start_day) return setErr("끝나는 날이 시작하는 날보다 앞이에요");
    if (initial) {
      updateHabit(store, initial.id, { ...f, title: f.title.trim() });
    } else {
      createHabit(store, f);
    }
    onDone();
  };

  return (
    <div className="space-y-4 rounded-3xl border border-line bg-surface-2/50 p-4">
      <input
        autoFocus
        value={f.title}
        onChange={(e) => set({ title: e.target.value })}
        placeholder="예: 독일어 듣기 30분, 아침 운동"
        className={cx(inputCls, "h-12 text-lg font-semibold")}
      />
      <div>
        <Label>요일</Label>
        <div className="flex gap-1.5">
          {ORDER.map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => set({ days: f.days.includes(x) ? f.days.filter((y) => y !== x) : [...f.days, x] })}
              className={cx(
                "size-10 rounded-xl text-sm font-bold",
                f.days.includes(x) ? "bg-accent text-accent-fg" : "bg-surface-3 text-muted",
              )}
            >
              {WEEKDAYS[x]}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5">
          <Chip onClick={() => set({ days: [1, 2, 3, 4, 5] })}>평일</Chip>
          <Chip onClick={() => set({ days: [0, 6] })}>주말</Chip>
          <Chip onClick={() => set({ days: [0, 1, 2, 3, 4, 5, 6] })}>매일</Chip>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>시작 시각</Label>
          <input type="time" value={f.start_time} onChange={(e) => e.target.value && set({ start_time: e.target.value })} className={inputCls} />
        </div>
        <div>
          <Label>길이(분)</Label>
          <select value={f.duration_min} onChange={(e) => set({ duration_min: Number(e.target.value) })} className={cx(inputCls, "py-2")}>
            {[...new Set([...DURATION_CHOICES, 10, 20, 180, f.duration_min])].sort((a, b) => a - b).map((m) => (
              <option key={m} value={m}>
                {m}분
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <Label>기간(선택) — 비워 두면 계속 반복해요</Label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={f.start_day ?? ""}
            onChange={(e) => set({ start_day: e.target.value || null })}
            aria-label="반복 시작하는 날"
            className={cx(inputCls, "w-auto!")}
          />
          <span className="text-sm text-muted">~</span>
          <input
            type="date"
            value={f.end_day ?? ""}
            min={f.start_day ?? undefined}
            onChange={(e) => set({ end_day: e.target.value || null })}
            aria-label="반복 끝나는 날"
            className={cx(inputCls, "w-auto!")}
          />
          {(f.start_day || f.end_day) && (
            <button type="button" onClick={() => set({ start_day: null, end_day: null })} className="text-xs font-semibold text-muted hover:text-fg">
              기간 없애기
            </button>
          )}
        </div>
      </div>
      <div>
        <Label>알림</Label>
        <div className="flex flex-wrap gap-1.5">
          {OFFSET_CHOICES.map((o) => (
            <Chip
              key={o}
              active={f.reminder_offsets.includes(o)}
              onClick={() =>
                set({
                  reminder_offsets: f.reminder_offsets.includes(o)
                    ? f.reminder_offsets.filter((x) => x !== o)
                    : [...f.reminder_offsets, o].sort((a, b) => b - a),
                })
              }
            >
              {fmtOffset(o)}
            </Chip>
          ))}
        </div>
      </div>
      <div>
        <Label>소리</Label>
        <select value={f.sound_id ?? ""} onChange={(e) => set({ sound_id: e.target.value || null })} className={cx(inputCls, "py-2")}>
          <option value="">기본</option>
          <SoundOptions custom={settings.customSounds} />
        </select>
      </div>
      <div>
        <Label>색</Label>
        <ColorPicker value={f.color} onChange={(color) => set({ color })} />
      </div>
      <Switch checked={f.strict} onChange={(strict) => set({ strict })} label="강제 모드" desc="안 하면 경고창 + 사유 입력" />
      {err && <p className="text-sm font-semibold text-danger">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          취소
        </Button>
        <Button variant="primary" onClick={save}>
          {initial ? "저장" : "습관 만들기"}
        </Button>
      </div>
    </div>
  );
}

export function HabitsSheet() {
  const { sheet, openSheet, habits, tasks, store } = usePlanner();
  const [editing, setEditing] = useState<Habit | "new" | null>(null);
  const today = startOfDay(new Date());
  const days14 = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const byKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) if (t.habit_id && t.occurrence_date) m.set(`${t.habit_id}:${t.occurrence_date}`, t.status);
    return m;
  }, [tasks]);

  if (sheet !== "habits") return null;
  return (
    <Modal
      open
      onClose={() => {
        setEditing(null);
        openSheet(null);
      }}
      title="습관"
      subtitle="정한 요일·시각마다 일정이 자동으로 생깁니다. 서버를 연결하면 앱을 안 열어도 생성·알림됩니다."
      size="lg"
    >
      {editing ? (
        <HabitForm initial={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
      ) : (
        <div className="space-y-3">
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus size={16} /> 새 습관
          </Button>
          {habits.length === 0 && (
            <Empty icon={<Repeat size={22} />} title="습관이 없습니다" desc="매일 하고 싶은 일 하나부터. 예: 독일어 단어 20개 (매일 21:00)" />
          )}
          {habits.map((h) => {
            const streak = habitStreak(h, tasks, today);
            return (
              <div key={h.id} className={cx("rounded-2xl border border-line p-4", !h.active && "opacity-60")}>
                <div className="flex items-start gap-3">
                  <span className="mt-1.5 size-3 shrink-0 rounded-full" style={{ background: COLOR_HEX[h.color] }} />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{h.title}</p>
                    <p className="mt-0.5 text-sm text-muted">
                      {h.days.length === 7 ? "매일" : ORDER.filter((x) => h.days.includes(x)).map((x) => WEEKDAYS[x]).join("·")} ·{" "}
                      <span className="font-mono tabular-nums">{h.start_time}</span> · {h.duration_min}분
                      {h.end_day && ` · ${habitRangeLabel(h)}`}
                      {!h.active && " · 일시중지"}
                    </p>
                  </div>
                  <span className={cx("flex items-center gap-1 font-mono text-lg font-bold tabular-nums", streak ? "text-warn" : "text-faint")}>
                    <Flame size={18} /> {streak}
                  </span>
                </div>
                <div className="mt-3 flex gap-1">
                  {days14.map((d) => {
                    const s = byKey.get(`${h.id}:${dayKey(d)}`);
                    const scheduled = h.days.includes(d.getDay());
                    return (
                      <span
                        key={dayKey(d)}
                        title={`${d.getMonth() + 1}/${d.getDate()} ${s ?? (scheduled ? "-" : "쉬는 날")}`}
                        className={cx(
                          "h-6 flex-1 rounded-md",
                          !scheduled
                            ? "bg-transparent"
                            : s === "done"
                              ? "bg-accent"
                              : s === "missed" || s === "skipped"
                                ? "bg-danger/70"
                                : s
                                  ? "bg-surface-3"
                                  : "border border-dashed border-line",
                        )}
                      />
                    );
                  })}
                </div>
                <div className="mt-3 flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(h)}>
                    <Pencil size={14} /> 편집
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => updateHabit(store, h.id, { active: !h.active })}>
                    {h.active ? <Pause size={14} /> : <Play size={14} />} {h.active ? "일시중지" : "다시 시작"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-danger"
                    onClick={() => {
                      if (!window.confirm(`'${h.title}' 습관을 지울까요? 지난 기록은 남고, 앞으로의 예정 회차만 지워집니다.`)) return;
                      deleteHabit(store, h.id);
                    }}
                  >
                    <Trash size={14} /> 삭제
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

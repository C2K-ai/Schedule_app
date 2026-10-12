"use client";

import { Check, Play, Repeat, RotateCcw, Star, Trash, Volume2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  completeTask,
  createHabit,
  createTask,
  deleteTask,
  liveCategories,
  reopenTask,
  scheduleWindow,
  startTask,
  taskState,
  updateTask,
} from "@/lib/planner";
import { DURATION_CHOICES, OFFSET_CHOICES } from "@/lib/settings";
import { findSound, playSound } from "@/lib/sound";
import { atTime, fmtOffset, fmtTime, MIN, parseDayKey, toDateInput, toHHMM, WEEKDAYS } from "@/lib/time";
import { COLOR_HEX, type ColorKey, type ScheduleKind, type Settings, type Task } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { usePlanner, type EditorState } from "./PlannerProvider";
import { SoundOptions } from "./SoundOptions";
import { Button, Chip, ColorPicker, cx, inputCls, Label, Modal, Segmented, Switch } from "./ui";

interface Draft {
  schedule: ScheduleKind;
  categoryId: string | null;
  starred: boolean;
  title: string;
  date: string;
  time: string;
  duration: number;
  color: ColorKey;
  offsets: number[];
  soundId: string | null;
  strict: boolean;
  notes: string;
  repeat: boolean;
  days: number[];
}

function initialDraft(task: Task | null, editor: EditorState, settings: Settings): Draft {
  if (task) {
    const s = new Date(task.starts_at);
    const kind = task.schedule ?? "timed";
    // 날짜만·날짜 없음의 시작·끝은 정렬용 가짜 값(0시~24시, 만든 시각) — '시간 지정'으로 바꿀 때 쓸 기본값을 따로 둔다
    const timed = kind === "timed";
    const next = new Date(Math.ceil(Date.now() / (15 * MIN)) * 15 * MIN);
    return {
      schedule: kind,
      categoryId: task.category_id ?? null,
      starred: task.starred ?? false,
      title: task.title,
      date: kind === "someday" ? toDateInput(new Date()) : toDateInput(s),
      time: timed ? toHHMM(s) : toHHMM(next),
      duration: timed ? Math.round((Date.parse(task.ends_at) - s.getTime()) / MIN) : 30,
      color: task.color,
      offsets: timed ? task.reminder_offsets : settings.defaultOffsets,
      soundId: task.sound_id,
      strict: timed ? task.strict : true,
      notes: task.notes ?? "",
      repeat: false,
      days: [s.getDay()],
    };
  }
  const s = editor.start ?? new Date(Math.ceil(Date.now() / (15 * MIN)) * 15 * MIN);
  const dur = editor.end ? Math.round((editor.end.getTime() - s.getTime()) / MIN) : 30;
  return {
    schedule: editor.schedule ?? "timed",
    categoryId: editor.categoryId ?? null,
    starred: editor.starred ?? false,
    title: editor.title ?? "",
    date: editor.day ?? toDateInput(s),
    time: toHHMM(s),
    duration: dur,
    color: "lime",
    offsets: settings.defaultOffsets,
    soundId: null,
    strict: true,
    notes: "",
    repeat: false,
    days: [s.getDay()],
  };
}

export function TaskEditor() {
  const { editor } = usePlanner();
  if (!editor) return null;
  // 열 때마다 key 가 바뀌어 초안이 새로 만들어진다
  return <EditorBody key={editor.taskId ?? `new-${editor.start?.getTime() ?? "now"}`} editor={editor} />;
}

function EditorBody({ editor }: { editor: EditorState }) {
  const { closeEditor, openReschedule, store, settings, snap } = usePlanner();
  const categories = useMemo(() => liveCategories(snap.db), [snap.db]);
  const now = useNow(10_000);
  const task = editor.taskId ? (store.db.tasks[editor.taskId] ?? null) : null;
  const [d, setD] = useState<Draft>(() => initialDraft(task, editor, settings));
  const [err, setErr] = useState<string | null>(null);
  // 삭제는 두 번 눌러야 된다(되돌리기 알림 대신)
  const [sure, setSure] = useState(false);
  const set = (p: Partial<Draft>) => setD({ ...d, ...p });
  const start = atTime(parseDayKey(d.date), d.time);
  const end = new Date(start.getTime() + d.duration * MIN);
  const st = task ? taskState(task, now, settings.graceMin) : null;
  const lockedDelete = task && task.strict && (st === "overdue" || st === "late");

  const timed = d.schedule === "timed";
  const save = () => {
    if (!d.title.trim()) return setErr("제목을 적어 주세요");
    if (timed && d.duration < 5) return setErr("최소 5분 이상");
    const win =
      d.schedule === "timed"
        ? { starts_at: start.toISOString(), ends_at: end.toISOString() }
        : d.schedule === "someday" && task?.schedule === "someday"
          ? { starts_at: task.starts_at, ends_at: task.ends_at }
          : scheduleWindow(d.schedule, { day: d.date });
    if (task) {
      // 이미 시작 시각이 지난 미시작 일정을 뒤로 미는 건 '미루기' — 사유 화면으로
      // 시각이 없는 일정으로 바꾸는 것도 강제(알림·경고)에서 빠져나가는 길이라 같이 막는다
      const movingLater = Date.parse(win.starts_at) > Date.parse(task.starts_at) || d.schedule !== "timed";
      if (task.status === "planned" && task.strict && (task.schedule ?? "timed") === "timed" && Date.parse(task.starts_at) <= now && movingLater) {
        return setErr("이미 시작했어야 하는 일정입니다. 뒤로 미루려면 메인 화면의 경고창에서 사유와 함께 미루세요.");
      }
      updateTask(store, task.id, {
        title: d.title.trim(),
        ...win,
        schedule: d.schedule,
        category_id: d.categoryId,
        starred: d.starred,
        color: d.color,
        reminder_offsets: timed ? [...d.offsets].sort((a, b) => b - a) : [],
        sound_id: d.soundId,
        strict: timed ? d.strict : false,
        notes: d.notes.trim() || null,
      });
    } else if (timed && d.repeat) {
      if (!d.days.length) return setErr("반복할 요일을 하나 이상 고르세요");
      createHabit(store, {
        title: d.title,
        color: d.color,
        days: d.days,
        start_time: d.time,
        duration_min: d.duration,
        reminder_offsets: [...d.offsets].sort((a, b) => b - a),
        sound_id: d.soundId,
        strict: d.strict,
      });
    } else {
      createTask(
        store,
        {
          title: d.title,
          schedule: d.schedule,
          day: d.date,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          color: d.color,
          category_id: d.categoryId,
          starred: d.starred,
          reminder_offsets: [...d.offsets].sort((a, b) => b - a),
          sound_id: d.soundId,
          strict: d.strict,
          notes: d.notes.trim() || null,
        },
        settings,
      );
    }
    closeEditor();
  };

  return (
    <Modal
      open
      onClose={closeEditor}
      title={task ? "일정 편집" : "새 일정"}
      subtitle={task?.habit_id ? "습관에서 만들어진 회차입니다 — 반복 설정은 '습관'에서 바꿉니다." : undefined}
      footer={
        <div className="flex items-center gap-2">
          {task && (
            <Button
              variant={sure ? "danger" : "ghost"}
              disabled={Boolean(lockedDelete)}
              title={lockedDelete ? "시작 안 한 강제 일정은 지울 수 없습니다 — 경고창에서 사유와 함께 건너뛰세요" : undefined}
              onClick={() => {
                if (!sure) return setSure(true);
                deleteTask(store, task.id);
                closeEditor();
              }}
            >
              <Trash size={16} /> {sure ? "정말 삭제" : "삭제"}
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={closeEditor}>
              취소
            </Button>
            <Button variant="primary" onClick={save}>
              {task ? "저장" : timed && d.repeat ? "습관 만들기" : "추가"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <input
          autoFocus={!task}
          value={d.title}
          onChange={(e) => set({ title: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && save()}
          placeholder="무엇을 할까요? 예: 독일어 단어 30개"
          className={cx(inputCls, "h-12 text-lg font-semibold")}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={d.schedule}
            onChange={(schedule) => set({ schedule })}
            options={[
              { value: "timed", label: "시간 지정" },
              { value: "day", label: "날짜만" },
              { value: "someday", label: "날짜 없음" },
            ]}
          />
          <button
            type="button"
            onClick={() => set({ starred: !d.starred })}
            aria-pressed={d.starred}
            className={cx(
              "inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold transition",
              d.starred ? "bg-warn/15 text-warn" : "bg-surface-2 text-muted hover:text-fg",
            )}
          >
            <Star size={15} fill={d.starred ? "currentColor" : "none"} /> 별표
          </button>
        </div>

        {categories.length > 0 && (
          <div>
            <Label>카테고리</Label>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() =>
                    set(
                      d.categoryId === c.id
                        ? { categoryId: null }
                        : { categoryId: c.id, ...(task ? {} : { color: c.color }) },
                    )
                  }
                  className={cx(
                    "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-semibold transition",
                    d.categoryId === c.id ? "border-transparent bg-fg text-bg" : "border-line bg-surface-2 text-muted hover:text-fg",
                  )}
                >
                  <span className="size-2 rounded-full" style={{ background: COLOR_HEX[c.color] }} />
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {task && (
          <div className="flex flex-wrap gap-2">
            {task.status === "planned" && (
              <Button size="sm" variant="primary" onClick={() => (startTask(store, task.id), closeEditor())}>
                <Play size={14} /> 시작
              </Button>
            )}
            {(task.status === "planned" || task.status === "in_progress") && (
              <Button size="sm" onClick={() => (completeTask(store, task.id), closeEditor())}>
                <Check size={14} /> 완료
              </Button>
            )}
            {task.status === "done" && (
              <Button size="sm" onClick={() => (reopenTask(store, task.id), closeEditor())}>
                <RotateCcw size={14} /> 다시 열기
              </Button>
            )}
            {(task.status === "skipped" || task.status === "missed") && (
              <Button size="sm" onClick={() => (closeEditor(), openReschedule(task.id))}>
                <RotateCcw size={14} /> 다시 잡기
              </Button>
            )}
            <span className="ml-auto self-center text-xs text-muted">
              상태:{" "}
              {{ planned: "예정", in_progress: "진행 중", done: "완료", skipped: "건너뜀", missed: "놓침" }[task.status]}
              {task.postpone_count > 0 && ` · ${task.postpone_count}회 미룸`}
            </span>
          </div>
        )}

        {d.schedule === "day" && (
          <div>
            <Label>날짜</Label>
            <input type="date" value={d.date} onChange={(e) => e.target.value && set({ date: e.target.value })} className={inputCls} />
          </div>
        )}
        {timed && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>날짜</Label>
            <input type="date" value={d.date} onChange={(e) => e.target.value && set({ date: e.target.value })} className={inputCls} />
          </div>
          <div>
            <Label>시작</Label>
            <input type="time" value={d.time} step={300} onChange={(e) => e.target.value && set({ time: e.target.value })} className={inputCls} />
          </div>
        </div>
        )}

        {timed && (
          <>
        <div>
          <Label hint={`${fmtTime(start)} – ${fmtTime(end)}`}>길이</Label>
          <div className="flex flex-wrap gap-1.5">
            {DURATION_CHOICES.map((m) => (
              <Chip key={m} active={d.duration === m} onClick={() => set({ duration: m })}>
                {m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}`}
              </Chip>
            ))}
            <input
              type="number"
              min={5}
              max={720}
              step={5}
              value={d.duration}
              onChange={(e) => set({ duration: Number(e.target.value) || 0 })}
              className={cx(inputCls, "h-9 w-24! py-1 text-sm")}
              aria-label="분 직접 입력"
            />
          </div>
        </div>

        <div>
          <Label hint="여러 개 선택">알림</Label>
          <div className="flex flex-wrap gap-1.5">
            {OFFSET_CHOICES.map((o) => (
              <Chip
                key={o}
                active={d.offsets.includes(o)}
                onClick={() => set({ offsets: d.offsets.includes(o) ? d.offsets.filter((x) => x !== o) : [...d.offsets, o] })}
              >
                {fmtOffset(o)}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <Label>알림 소리</Label>
          <div className="flex gap-2">
            <select
              value={d.soundId ?? ""}
              onChange={(e) => set({ soundId: e.target.value || null })}
              className={cx(inputCls, "h-10 py-1")}
            >
              <option value="">기본 (알림 종류별 설정)</option>
              <SoundOptions custom={settings.customSounds} />
            </select>
            <Button
              variant="soft"
              aria-label="미리 듣기"
              onClick={() => playSound(findSound(d.soundId ?? settings.sounds.start, settings.customSounds), { volume: settings.volume })}
            >
              <Volume2 size={16} />
            </Button>
          </div>
        </div>
          </>
        )}

        <div>
          <Label>색</Label>
          <ColorPicker value={d.color} onChange={(color) => set({ color })} />
        </div>

        {timed && (
        <div className="rounded-2xl border border-line bg-surface-2/60 px-4 py-2">
          <Switch
            checked={d.strict}
            onChange={(strict) => set({ strict })}
            label="강제 모드"
            desc={`시작 ${settings.graceMin}분이 지나도 안 하면 빨간 경고창이 뜨고, 미루거나 건너뛰려면 사유를 써야 합니다.`}
          />
          {!task && (
            <>
              <div className="my-1 h-px bg-line" />
              <Switch
                checked={d.repeat}
                onChange={(repeat) => set({ repeat })}
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <Repeat size={14} /> 매주 반복 (습관)
                  </span>
                }
                desc="정한 요일마다 자동으로 일정이 생깁니다. 연속 달성(스트릭)이 기록됩니다."
              />
              {d.repeat && (
                <div className="flex gap-1.5 pt-1 pb-2">
                  {[1, 2, 3, 4, 5, 6, 0].map((x) => (
                    <button
                      key={x}
                      type="button"
                      onClick={() => set({ days: d.days.includes(x) ? d.days.filter((y) => y !== x) : [...d.days, x] })}
                      className={cx(
                        "size-9 rounded-xl text-sm font-bold",
                        d.days.includes(x) ? "bg-accent text-accent-fg" : "bg-surface-3 text-muted",
                      )}
                    >
                      {WEEKDAYS[x]}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        )}

        {!(timed && d.repeat) && (
          <div>
            <Label>메모</Label>
            <textarea
              value={d.notes}
              onChange={(e) => set({ notes: e.target.value })}
              rows={2}
              placeholder="준비물, 링크, 목표…"
              className={cx(inputCls, "resize-none")}
            />
          </div>
        )}

        {err && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">{err}</p>}
      </div>
    </Modal>
  );
}

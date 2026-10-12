"use client";

import { CalendarRange, ImagePlus, Plus, Table2, Trash } from "lucide-react";
import { useMemo, useState } from "react";
import { createHabit, deleteHabit, updateHabit } from "@/lib/planner";
import {
  blocksFor,
  gridDays,
  guessSemester,
  hourRange,
  periodText,
  pickGroup,
  semesterGroups,
  timetableHabits,
  toHHMM,
  toMin,
  type Semester,
  type SemesterGroup,
} from "@/lib/timetable";
import { dayKey, WEEKDAYS } from "@/lib/time";
import { COLOR_HEX, type ColorKey, type Habit } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { usePlanner } from "./PlannerProvider";
import { DayPicker, PeriodInputs, TimetableImport } from "./TimetableImport";
import { Button, Card, ColorPicker, cx, Empty, inputCls, Label, Modal } from "./ui";

/** 한 시간 높이(px) */
const HOUR = 54;

/** 캘린더 탭 '시간표' — 수업(시간표에 보이는 반복)을 학기별 주간 칸으로. 칸을 누르면 고치기 */
export function TimetableView() {
  const { habits } = usePlanner();
  const now = useNow(60_000);
  const today = dayKey(new Date(now));
  const groups = useMemo(() => semesterGroups(timetableHabits(habits)), [habits]);
  const [picked, setPicked] = useState<string | null>(null);
  const group = groups.find((g) => g.key === picked) ?? pickGroup(groups, today);
  const [editing, setEditing] = useState<Habit | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [period, setPeriod] = useState(false);
  // 새 수업·사진으로 넣기의 학기 — 보고 있는 학기, 없으면 이번 학기 짐작
  const sem: Semester = group && group.start && group.end ? { start: group.start, end: group.end } : guessSemester(new Date(now));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {group && (
          <div className="min-w-0">
            {groups.length > 1 ? (
              <select
                value={group.key}
                onChange={(e) => setPicked(e.target.value)}
                aria-label="학기 고르기"
                className="max-w-full rounded-lg bg-transparent font-bold outline-none"
              >
                {groups.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label} ({periodText(g.start, g.end)})
                  </option>
                ))}
              </select>
            ) : (
              <p className="font-bold">{group.label}</p>
            )}
            <p className="text-xs text-muted">
              {periodText(group.start, group.end)} · 수업 {group.habits.length}개
            </p>
          </div>
        )}
        <div className="ml-auto flex flex-wrap gap-1.5">
          {group && (
            <Button size="sm" variant="ghost" onClick={() => setPeriod(true)}>
              <CalendarRange size={15} /> 학기 기간
            </Button>
          )}
          <Button size="sm" variant="soft" onClick={() => setEditing("new")}>
            <Plus size={15} /> 수업
          </Button>
          <Button size="sm" variant="primary" onClick={() => setImporting(true)}>
            <ImagePlus size={15} /> 사진으로 넣기
          </Button>
        </div>
      </div>

      {group ? (
        <Card className="overflow-hidden">
          <Grid group={group} today={today} now={now} onPick={setEditing} />
        </Card>
      ) : (
        <Card>
          <Empty
            icon={<Table2 size={22} />}
            title="시간표가 아직 없어요"
            desc="에브리타임·학교 포털 캡처나 종이 시간표 사진을 올리면 수업을 학기 동안 매주 한 번에 넣어요. 직접 하나씩 넣어도 돼요."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => setImporting(true)}>
                  <ImagePlus size={16} /> 사진으로 넣기
                </Button>
                <Button variant="soft" onClick={() => setEditing("new")}>
                  <Plus size={16} /> 직접 넣기
                </Button>
              </div>
            }
          />
        </Card>
      )}
      <p className="text-xs text-faint">수업은 반복 일정으로 들어가서 주·일 보기와 알림에도 나와요. 습관(☰ → 습관)에서 &lsquo;시간표에 보이기&rsquo;를 켜면 알바·동아리도 여기 보여요.</p>

      {editing && (
        <ClassEditor initial={editing === "new" ? null : editing} sem={sem} askPeriod={!group} onClose={() => setEditing(null)} />
      )}
      {period && group && <PeriodEditor group={group} onClose={() => setPeriod(false)} onSaved={(key) => setPicked(key)} />}
      {importing && (
        <TimetableImport
          sem={sem}
          existing={group?.habits ?? []}
          onClose={() => setImporting(false)}
          onSaved={(key) => {
            setPicked(key);
            setImporting(false);
          }}
        />
      )}
    </div>
  );
}

function Grid({ group, today, now, onPick }: { group: SemesterGroup; today: string; now: number; onPick: (h: Habit) => void }) {
  const days = gridDays(group.habits);
  const { from, to } = hourRange(group.habits);
  const blocks = blocksFor(group.habits, days);
  const live = (!group.start || group.start <= today) && (!group.end || group.end >= today);
  const d = new Date(now);
  const todayDow = d.getDay();
  const nowMin = d.getHours() * 60 + d.getMinutes();
  const cols = `2rem repeat(${days.length}, minmax(0, 1fr))`;
  return (
    <div className="select-none">
      <div className="grid border-b border-line" style={{ gridTemplateColumns: cols }}>
        <span />
        {days.map((x) => (
          <span
            key={x}
            className={cx(
              "py-2 text-center text-xs font-semibold",
              live && x === todayDow ? "text-accent-text" : x === 0 ? "text-danger" : "text-muted",
            )}
          >
            {WEEKDAYS[x]}
          </span>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: cols, height: (to - from) * HOUR }}>
        <div className="relative">
          {Array.from({ length: to - from }, (_, i) => (
            <span key={i} className="absolute right-1.5 font-mono text-[10px] text-faint tabular-nums" style={{ top: i * HOUR + 2 }}>
              {from + i}
            </span>
          ))}
        </div>
        {days.map((x) => (
          <div key={x} className={cx("relative border-l border-line", live && x === todayDow && "bg-accent/5")}>
            {Array.from({ length: to - from - 1 }, (_, i) => (
              <span key={i} className="absolute inset-x-0 border-t border-line/60" style={{ top: (i + 1) * HOUR }} />
            ))}
            {blocks
              .filter((b) => b.day === x)
              .map((b) => (
                <button
                  key={b.habit.id}
                  type="button"
                  onClick={() => onPick(b.habit)}
                  title={`${b.habit.title} ${toHHMM(b.start)}–${toHHMM(b.end)}${b.habit.place ? ` · ${b.habit.place}` : ""}`}
                  className="absolute overflow-hidden rounded-lg px-1 py-0.5 text-left text-[#111] shadow-sm transition hover:brightness-95 active:scale-[0.98]"
                  style={{
                    top: ((b.start - from * 60) / 60) * HOUR + 1,
                    height: Math.max(18, ((b.end - b.start) / 60) * HOUR - 2),
                    left: `calc(${(b.lane / b.lanes) * 100}% + 1px)`,
                    width: `calc(${100 / b.lanes}% - 2px)`,
                    background: COLOR_HEX[b.habit.color],
                  }}
                >
                  <span className="line-clamp-3 text-[11px] leading-tight font-bold break-all">{b.habit.title}</span>
                  {b.habit.place && <span className="mt-0.5 line-clamp-2 text-[10px] leading-tight opacity-75 break-all">{b.habit.place}</span>}
                </button>
              ))}
            {live && x === todayDow && nowMin >= from * 60 && nowMin <= to * 60 && (
              <span className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-danger" style={{ top: ((nowMin - from * 60) / 60) * HOUR }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 수업 하나 넣기·고치기 — 이름·강의실·요일·시작·끝·색. 학기 기간은 학기 전체에서 같이 바꾼다 */
function ClassEditor({ initial, sem, askPeriod, onClose }: { initial: Habit | null; sem: Semester; askPeriod: boolean; onClose: () => void }) {
  const { store, settings } = usePlanner();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [place, setPlace] = useState(initial?.place ?? "");
  const [days, setDays] = useState<number[]>(initial?.days ?? [1]);
  const [start, setStart] = useState(initial?.start_time ?? "09:00");
  const [end, setEnd] = useState(initial ? toHHMM(toMin(initial.start_time) + initial.duration_min) : "10:15");
  const [color, setColor] = useState<ColorKey>(initial?.color ?? "violet");
  const [range, setRange] = useState<Semester>(sem);
  const [err, setErr] = useState<string | null>(null);

  const save = () => {
    const dur = toMin(end) - toMin(start);
    if (!title.trim()) return setErr("과목 이름을 적어 주세요");
    if (!days.length) return setErr("요일을 하나 이상 고르세요");
    if (dur < 5) return setErr("끝나는 시각이 시작보다 뒤여야 해요");
    if (askPeriod && (!range.start || !range.end || range.end < range.start)) return setErr("학기 기간을 확인해 주세요");
    const fields = { title: title.trim(), place: place.trim().slice(0, 60) || null, days: [...days].sort(), start_time: start, duration_min: dur, color };
    if (initial) updateHabit(store, initial.id, fields);
    else
      createHabit(store, {
        ...fields,
        reminder_offsets: settings.defaultOffsets,
        sound_id: null,
        strict: false,
        start_day: range.start || null,
        end_day: range.end || null,
        in_timetable: true,
      });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? "수업 고치기" : "수업 넣기"}
      subtitle={askPeriod ? undefined : `${periodText(sem.start, sem.end)} 동안 매주 반복돼요`}
      footer={
        <div className="flex gap-2">
          {initial && (
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() => {
                if (!window.confirm(`'${initial.title}' 수업을 지울까요? 앞으로의 수업 일정도 같이 지워져요.`)) return;
                deleteHabit(store, initial.id);
                onClose();
              }}
            >
              <Trash size={15} /> 지우기
            </Button>
          )}
          <Button variant="ghost" className="ml-auto" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" onClick={save}>
            {initial ? "저장" : "넣기"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <input autoFocus={!initial} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="과목 이름 (예: 자료구조)" aria-label="과목 이름" className={cx(inputCls, "h-12 text-lg font-semibold")} />
        <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="강의실 (예: 공학관 301)" aria-label="강의실" maxLength={60} className={inputCls} />
        <div>
          <Label>요일</Label>
          <DayPicker value={days} onChange={setDays} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>시작</Label>
            <input type="time" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} className={inputCls} />
          </div>
          <div>
            <Label>끝</Label>
            <input type="time" value={end} onChange={(e) => e.target.value && setEnd(e.target.value)} className={inputCls} />
          </div>
        </div>
        {askPeriod && (
          <div>
            <Label>학기 기간 — 이 동안 매주 반복돼요</Label>
            <PeriodInputs value={range} onChange={setRange} />
          </div>
        )}
        <div>
          <Label>색</Label>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        {err && <p className="text-sm font-semibold text-danger">{err}</p>}
      </div>
    </Modal>
  );
}

/** 학기 기간 바꾸기 — 이 학기의 수업 전부 같이(개강·종강이 바뀌었을 때) */
function PeriodEditor({ group, onClose, onSaved }: { group: SemesterGroup; onClose: () => void; onSaved: (key: string) => void }) {
  const { store } = usePlanner();
  const [range, setRange] = useState<Semester>({ start: group.start, end: group.end });
  const [err, setErr] = useState<string | null>(null);
  const save = () => {
    if (!range.start || !range.end || range.end < range.start) return setErr("종강이 개강보다 뒤여야 해요");
    for (const h of group.habits) updateHabit(store, h.id, { start_day: range.start, end_day: range.end });
    onSaved(`${range.start}~${range.end}`);
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="학기 기간"
      subtitle={`수업 ${group.habits.length}개가 이 기간 동안만 매주 반복돼요. 종강하면 알아서 멈춰요.`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" onClick={save}>
            저장
          </Button>
        </div>
      }
    >
      <PeriodInputs value={range} onChange={setRange} />
      {err && <p className="mt-3 text-sm font-semibold text-danger">{err}</p>}
    </Modal>
  );
}

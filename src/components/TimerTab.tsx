"use client";

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Maximize2,
  Minimize2,
  Pencil,
  Play,
  Plus,
  Square,
  Trash,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  activeStudy,
  createSubject,
  deleteStudySession,
  deleteSubject,
  liveStudy,
  liveSubjects,
  startStudy,
  stopStudy,
  studyBySubject,
  studyDayStart,
  studySeconds,
  tenMinuteGrid,
  updateSubject,
} from "@/lib/planner";
import { addDays, DAY, dayKey, fmtDate, fmtTime, MIN, parseDayKey, startOfDay, uuid } from "@/lib/time";
import { COLOR_HEX, COLOR_KEYS, type StudySession, type Subject } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { ListManager } from "./ListManager";
import { usePlanner } from "./PlannerProvider";
import { fmtHM, fmtHMS } from "./Study";
import { Button, Card, cx, IconButton, inputCls, Modal } from "./ui";

const SUGGESTED = ["국어", "수학", "영어", "독일어", "코딩", "독서"];

function ddayLabel(date: string, today: Date) {
  const diff = Math.round((parseDayKey(date).getTime() - startOfDay(today).getTime()) / DAY);
  return diff === 0 ? "D-Day" : diff > 0 ? `D-${diff}` : `D+${-diff}`;
}

/** 공부하는 동안 화면을 꽉 채우는 시계 — 화면 꺼짐도 막는다 */
function BigClock({ onClose }: { onClose: () => void }) {
  const { snap, store, settings } = usePlanner();
  const now = useNow(1000);
  const active = activeStudy(snap.db);
  const sessions = useMemo(() => liveStudy(snap.db), [snap.db]);
  const subject = active?.subject_id ? snap.db.subjects[active.subject_id] : null;
  const from = studyDayStart(new Date(now), settings.dayStartHour).getTime();
  const total = studySeconds(sessions, from, from + DAY, now);
  const subjectSec = active
    ? studySeconds(
        sessions.filter((x) => x.subject_id === active.subject_id),
        from,
        from + DAY,
        now,
      )
    : 0;

  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const req = () =>
      nav.wakeLock
        ?.request("screen")
        .then((l) => (lock = l))
        .catch(() => {});
    void req();
    const onVis = () => document.visibilityState === "visible" && void req();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release().catch(() => {});
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[#07061a] px-6 text-white">
      <button
        onClick={onClose}
        aria-label="작게 보기"
        className="absolute top-[max(16px,env(safe-area-inset-top))] right-4 grid size-11 place-items-center rounded-xl text-white/60 hover:text-white"
      >
        <Minimize2 size={22} />
      </button>
      <p className="flex items-center gap-2 text-lg font-semibold text-white/80">
        <span className="size-3 rounded-full" style={{ background: subject ? COLOR_HEX[subject.color] : "var(--accent)" }} />
        {active ? (subject?.name ?? "공부") : "멈춤"}
      </p>
      <p className="font-mono text-[18vw] leading-none font-bold tracking-tight tabular-nums md:text-[120px]">
        {fmtHMS(active ? subjectSec : total)}
      </p>
      <p className="text-sm text-white/60">
        오늘 전체 <b className="font-mono text-white tabular-nums">{fmtHMS(total)}</b>
        {active && <> · 이번 구간 {fmtHM((now - Date.parse(active.started_at)) / 1000)}</>}
      </p>
      {active ? (
        <button
          onClick={() => stopStudy(store)}
          className="mt-4 inline-flex h-14 items-center gap-2 rounded-full bg-white/10 px-8 text-lg font-bold hover:bg-white/20"
        >
          <Square size={18} fill="currentColor" /> 멈추기
        </button>
      ) : (
        <button
          onClick={onClose}
          className="mt-4 inline-flex h-14 items-center gap-2 rounded-full bg-white/10 px-8 text-lg font-bold hover:bg-white/20"
        >
          닫기
        </button>
      )}
      {settings.studyAutoPause && (
        <p className="absolute bottom-[max(20px,env(safe-area-inset-bottom))] text-xs text-white/40">
          앱을 1분 넘게 벗어나면 자동으로 멈춥니다
        </p>
      )}
    </div>
  );
}

/** 10분 플래너 — 한 줄이 한 시간, 한 칸이 10분 */
function TenMinutePlanner({ dayStart, sessions, subjects }: { dayStart: Date; sessions: StudySession[]; subjects: Map<string, Subject> }) {
  const now = useNow(30_000);
  const grid = useMemo(() => tenMinuteGrid(sessions, dayStart, now), [sessions, dayStart, now]);
  const [hover, setHover] = useState<number | null>(null);
  const label = (i: number) => {
    const s = new Date(dayStart.getTime() + i * 10 * MIN);
    const id = grid[i];
    const name = id === null ? "공부 안 함" : id === "" ? "과목 없음" : (subjects.get(id)?.name ?? "지운 과목");
    return `${fmtTime(s)}–${fmtTime(new Date(s.getTime() + 10 * MIN))} · ${name}`;
  };
  return (
    <div>
      <div className="grid grid-cols-[2.25rem_1fr] gap-x-2 gap-y-[3px]" onMouseLeave={() => setHover(null)}>
        {Array.from({ length: 24 }, (_, h) => {
          const hour = (dayStart.getHours() + h) % 24;
          return (
            <div key={h} className="contents">
              <span className="self-center text-right font-mono text-[11px] text-faint tabular-nums">{String(hour).padStart(2, "0")}</span>
              <div className="grid grid-cols-6 gap-[2px]">
                {Array.from({ length: 6 }, (_, c) => {
                  const i = h * 6 + c;
                  const id = grid[i];
                  const color = id === null ? undefined : id === "" ? "var(--accent)" : COLOR_HEX[subjects.get(id)?.color ?? "slate"];
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-label={label(i)}
                      title={label(i)}
                      onMouseEnter={() => setHover(i)}
                      onFocus={() => setHover(i)}
                      onClick={() => setHover(i)}
                      className={cx("h-5 rounded-[4px] md:h-6", hover === i && "ring-2 ring-fg/70")}
                      style={{ background: color ?? "color-mix(in oklab, var(--fg) 7%, transparent)" }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 h-5 text-center font-mono text-xs text-muted tabular-nums">
        {hover !== null ? label(hover) : "칸을 누르면 시간과 과목이 보여요"}
      </p>
    </div>
  );
}

function ManualAdd({ day, subjects, onClose }: { day: Date; subjects: Subject[]; onClose: () => void }) {
  const { store, settings } = usePlanner();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("10:00");
  const [err, setErr] = useState<string | null>(null);
  const save = () => {
    const [fh, fm] = from.split(":").map(Number);
    const [th, tm] = to.split(":").map(Number);
    // 공부 하루는 dayStartHour 에 시작한다 — 그보다 이른 시각(새벽)은 다음 날짜의 시각
    const at = (h: number, m: number) => {
      const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
      return h < settings.dayStartHour ? addDays(d, 1) : d;
    };
    const s = at(fh, fm);
    let e = at(th, tm);
    if (e <= s) e = addDays(e, 1); // 자정을 넘긴 공부
    if (e.getTime() > Date.now()) return setErr("아직 오지 않은 시간은 넣을 수 없어요");
    if (e.getTime() - s.getTime() > 16 * 3600_000) return setErr("16시간을 넘을 수 없어요");
    const now = new Date().toISOString();
    store.put("study_sessions", {
      id: uuid(),
      subject_id: subjectId || null,
      task_id: null,
      started_at: s.toISOString(),
      ended_at: e.toISOString(),
      created_at: now,
      updated_at: now,
      deleted_at: null,
    });
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="공부 기록 직접 넣기"
      subtitle={`${fmtDate(day)} — 타이머를 깜빡했을 때`}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" onClick={save}>
            넣기
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className={inputCls} aria-label="과목">
          <option value="">과목 없음</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="time"
            value={from}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
            className={inputCls}
            aria-label="시작"
          />
          <input type="time" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} className={inputCls} aria-label="끝" />
        </div>
        {err && <p className="text-sm font-semibold text-danger">{err}</p>}
      </div>
    </Modal>
  );
}

export function TimerTab() {
  const { snap, store, settings, updateSettings } = usePlanner();
  const now = useNow(1000);
  const subjects = useMemo(() => liveSubjects(snap.db), [snap.db]);
  const subjectMap = useMemo(() => new Map(Object.values(snap.db.subjects).map((s) => [s.id, s])), [snap.db.subjects]);
  const sessions = useMemo(() => liveStudy(snap.db), [snap.db]);
  const active = activeStudy(snap.db);
  const [big, setBig] = useState(false);
  const [editSubjects, setEditSubjects] = useState(false);
  const [manual, setManual] = useState(false);
  const [newName, setNewName] = useState("");
  const [ddayForm, setDdayForm] = useState(false);
  const [dd, setDd] = useState({ title: "", date: dayKey(addDays(new Date(), 30)) });
  const [offset, setOffset] = useState(0);
  const [plannerOpen, setPlannerOpen] = useState(false);

  const todayStart = studyDayStart(new Date(now), settings.dayStartHour);
  const from = todayStart.getTime();
  const total = studySeconds(sessions, from, from + DAY, now);
  const bySubject = studyBySubject(sessions, from, from + DAY, now);
  const goal = settings.studyGoalMin * 60;
  const goalPct = goal ? Math.min(1, total / goal) : 0;

  // 오늘 구간들 — 시작·끝·최대 집중
  const todays = sessions
    .filter((x) => Date.parse(x.started_at) < from + DAY && (x.ended_at ? Date.parse(x.ended_at) : now) > from)
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  const longest = todays.reduce((m, x) => Math.max(m, ((x.ended_at ? Date.parse(x.ended_at) : now) - Date.parse(x.started_at)) / 1000), 0);

  // 플래너에서 보는 날
  const viewStart = addDays(todayStart, offset);
  const viewFrom = viewStart.getTime();
  const viewSessions = sessions
    .filter((x) => Date.parse(x.started_at) < viewFrom + DAY && (x.ended_at ? Date.parse(x.ended_at) : now) > viewFrom)
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  const viewBy = studyBySubject(viewSessions, viewFrom, viewFrom + DAY, now);
  const viewTotal = studySeconds(viewSessions, viewFrom, viewFrom + DAY, now);
  const viewDay = new Date(viewStart.getFullYear(), viewStart.getMonth(), viewStart.getDate());

  const addSubject = (name: string) => {
    const n = name.trim();
    if (!n) return;
    createSubject(store, n, COLOR_KEYS[subjects.length % COLOR_KEYS.length]);
    setNewName("");
  };

  return (
    <div className="space-y-5">
      {/* 오늘 합계 */}
      <Card className="relative overflow-hidden p-5 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-muted">
            {fmtDate(new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate()))} 공부
          </p>
          {settings.ddays.map((d) => (
            <span
              key={d.id}
              className="inline-flex items-center gap-1 rounded-lg bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent-text"
            >
              {d.title} {ddayLabel(d.date, new Date(now))}
              <button
                aria-label={`${d.title} 지우기`}
                onClick={() => updateSettings({ ddays: settings.ddays.filter((x) => x.id !== d.id) })}
                className="opacity-60 hover:opacity-100"
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <button
            onClick={() => setDdayForm(!ddayForm)}
            className="rounded-lg px-2 py-0.5 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-fg"
          >
            + D-Day
          </button>
          <IconButton label="크게 보기" onClick={() => setBig(true)} className="ml-auto -mr-2 size-9">
            <Maximize2 size={17} />
          </IconButton>
        </div>
        {ddayForm && (
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={dd.title}
              onChange={(e) => setDd({ ...dd, title: e.target.value })}
              placeholder="예: 수능, 토익"
              className={cx(inputCls, "h-9 w-40! py-1 text-sm")}
            />
            <input
              type="date"
              value={dd.date}
              onChange={(e) => e.target.value && setDd({ ...dd, date: e.target.value })}
              className={cx(inputCls, "h-9 w-auto! py-1 text-sm")}
            />
            <Button
              size="sm"
              variant="primary"
              disabled={!dd.title.trim()}
              onClick={() => {
                updateSettings({ ddays: [...settings.ddays, { id: uuid(), title: dd.title.trim().slice(0, 20), date: dd.date }] });
                setDd({ ...dd, title: "" });
                setDdayForm(false);
              }}
            >
              추가
            </Button>
          </div>
        )}
        <p className="mt-3 font-mono text-[56px] leading-none font-bold tracking-tight md:text-[72px]">{fmtHMS(total)}</p>
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-xs text-muted">
            <span>
              목표{" "}
              <select
                value={settings.studyGoalMin}
                onChange={(e) => updateSettings({ studyGoalMin: Number(e.target.value) })}
                className="rounded bg-transparent font-bold text-fg outline-none"
                aria-label="하루 목표"
              >
                {Array.from({ length: 16 }, (_, i) => (i + 1) * 60).map((m) => (
                  <option key={m} value={m}>
                    {m / 60}시간
                  </option>
                ))}
              </select>
            </span>
            <span className="font-mono font-bold text-fg tabular-nums">{Math.round(goalPct * 100)}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--accent)_18%,transparent)]">
            <div className="h-full rounded-full bg-accent transition-[width] duration-1000" style={{ width: `${goalPct * 100}%` }} />
          </div>
        </div>
        {todays.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            시작 <b className="font-mono text-fg tabular-nums">{fmtTime(todays[0].started_at)}</b>
            {longest > 0 && (
              <>
                {" "}
                · 최대 집중 <b className="text-fg">{fmtHM(longest)}</b>
              </>
            )}
          </p>
        )}
      </Card>

      {/* 과목 */}
      <Card className="p-2">
        <div className="flex items-center px-3 pt-2 pb-1">
          <h3 className="flex-1 text-[13px] font-bold text-muted">과목</h3>
          {subjects.length > 0 && (
            <button
              onClick={() => setEditSubjects(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-fg"
            >
              <Pencil size={12} /> 편집
            </button>
          )}
        </div>
        {subjects.length === 0 && (
          <div className="px-3 pb-2">
            <p className="text-sm text-muted">과목을 만들고 ▶ 를 누르면 시간이 쌓여요. 바로 골라도 돼요:</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SUGGESTED.map((s) => (
                <button
                  key={s}
                  onClick={() => addSubject(s)}
                  className="h-8 rounded-lg bg-surface-2 px-3 text-sm font-semibold hover:bg-surface-3"
                >
                  + {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <ul>
          {subjects.map((s) => {
            const running = active?.subject_id === s.id;
            const sec = bySubject.get(s.id) ?? 0;
            return (
              <li key={s.id} className={cx("flex items-center gap-3 rounded-2xl px-3 py-2.5", running && "bg-surface-2")}>
                <button
                  aria-label={running ? `${s.name} 멈추기` : `${s.name} 시작`}
                  onClick={() => (running ? stopStudy(store) : startStudy(store, s.id))}
                  className="grid size-11 shrink-0 place-items-center rounded-full text-[#0b0920] transition active:scale-95"
                  style={{ background: COLOR_HEX[s.color] }}
                >
                  {running ? <Square size={15} fill="currentColor" /> : <Play size={17} fill="currentColor" className="ml-0.5" />}
                </button>
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{s.name}</span>
                <span className={cx("font-mono text-base font-bold tabular-nums", !sec && !running && "text-faint")}>{fmtHMS(sec)}</span>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-2 px-3 pt-1 pb-2">
          <Plus size={16} className="text-muted" />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && addSubject(newName)}
            placeholder="과목 추가"
            maxLength={40}
            className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          />
          {newName.trim() && (
            <Button size="sm" onClick={() => addSubject(newName)}>
              추가
            </Button>
          )}
        </div>
        {bySubject.get("") ? <p className="px-3 pb-2 text-xs text-muted">과목 없이 잰 시간 {fmtHM(bySubject.get("")!)}</p> : null}
      </Card>

      {/* 10분 플래너 — 평소엔 접어 둔다 */}
      {!plannerOpen ? (
        <button
          onClick={() => setPlannerOpen(true)}
          className="flex w-full items-center gap-2 rounded-3xl border border-line bg-surface px-5 py-4 text-left shadow-card"
        >
          <span className="flex-1 font-bold">10분 플래너 · 기록 보기</span>
          <ChevronDown size={18} className="text-muted" />
        </button>
      ) : (
        <Card className="p-4 md:p-5">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPlannerOpen(false)}
              className="flex flex-1 items-center gap-1 text-left text-[13px] font-bold text-muted"
            >
              10분 플래너 <ChevronUp size={15} />
            </button>
            <IconButton label="이전 날" onClick={() => setOffset(offset - 1)} className="size-8">
              <ChevronLeft size={18} />
            </IconButton>
            <span className="min-w-[110px] text-center text-sm font-semibold">{offset === 0 ? "오늘" : fmtDate(viewDay)}</span>
            <IconButton label="다음 날" onClick={() => setOffset(Math.min(0, offset + 1))} className="size-8" disabled={offset === 0}>
              <ChevronRight size={18} />
            </IconButton>
          </div>
          <p className="mt-1 mb-3 font-mono text-2xl font-bold tabular-nums">{fmtHMS(viewTotal)}</p>
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_240px]">
            <TenMinutePlanner dayStart={viewStart} sessions={viewSessions} subjects={subjectMap} />
            <div>
              <p className="mb-2 text-xs font-bold text-muted">과목별</p>
              {viewBy.size === 0 ? (
                <p className="text-sm text-faint">기록 없음</p>
              ) : (
                <ul className="space-y-1.5">
                  {[...viewBy.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([id, sec]) => {
                      const s = id ? subjectMap.get(id) : null;
                      return (
                        <li key={id || "none"} className="flex items-center gap-2 text-sm">
                          <span className="size-2.5 rounded-sm" style={{ background: s ? COLOR_HEX[s.color] : "var(--accent)" }} />
                          <span className="min-w-0 flex-1 truncate">{s?.name ?? (id ? "지운 과목" : "과목 없음")}</span>
                          <span className="font-mono text-xs tabular-nums">{fmtHM(sec)}</span>
                        </li>
                      );
                    })}
                </ul>
              )}
              <p className="mt-4 mb-2 text-xs font-bold text-muted">구간</p>
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {viewSessions.map((x) => {
                  const s = x.subject_id ? subjectMap.get(x.subject_id) : null;
                  const end = x.ended_at ? Date.parse(x.ended_at) : now;
                  return (
                    <li key={x.id} className="group flex items-center gap-2 text-xs">
                      <span className="size-2 rounded-full" style={{ background: s ? COLOR_HEX[s.color] : "var(--accent)" }} />
                      <span className="font-mono tabular-nums">
                        {fmtTime(x.started_at)}–{x.ended_at ? fmtTime(x.ended_at) : "지금"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-muted">{s?.name ?? "과목 없음"}</span>
                      <span className="font-mono text-muted tabular-nums">{fmtHM((end - Date.parse(x.started_at)) / 1000)}</span>
                      {x.ended_at && (
                        <button
                          aria-label="이 구간 지우기"
                          onClick={() => {
                            deleteStudySession(store, x.id);
                          }}
                          className="text-faint hover:text-danger md:opacity-0 md:group-hover:opacity-100"
                        >
                          <Trash size={12} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <button onClick={() => setManual(true)} className="mt-3 text-xs font-semibold text-muted hover:text-fg">
                + 기록 직접 넣기
              </button>
            </div>
          </div>
        </Card>
      )}

      {big && <BigClock onClose={() => setBig(false)} />}
      {manual && <ManualAdd day={viewDay} subjects={subjects} onClose={() => setManual(false)} />}
      <ListManager
        open={editSubjects}
        onClose={() => setEditSubjects(false)}
        title="과목"
        subtitle="과목을 지워도 공부한 시간 기록은 남아요."
        items={subjects}
        placeholder="새 과목 이름"
        onCreate={(name, color) => createSubject(store, name, color)}
        onUpdate={(id, patch) => updateSubject(store, id, patch)}
        onDelete={(s) => {
          deleteSubject(store, s.id);
        }}
      />
    </div>
  );
}

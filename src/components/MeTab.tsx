"use client";

import { BriefcaseBusiness, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { liveCareer, liveCategories, liveStudy, liveSubjects, studyBySubject, studyDayStart } from "@/lib/planner";
import { completionRate, completionsByDay, perfectDays, studyLevel, studyWeek, weekdayAverages, yearGrid } from "@/lib/stats";
import { addDays, DAY, dayKey, fmtDate, startOfDay, startOfWeek, WEEKDAYS } from "@/lib/time";
import { COLOR_HEX } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { Columns, Donut, HEAT, HeatLegend, YearHeatmap } from "./Charts";
import { usePlanner } from "./PlannerProvider";
import { HabitMini, ReasonFeed } from "./SidePanels";
import { fmtHM } from "./Study";
import { Card, cx, IconButton, Segmented } from "./ui";

const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1 text-[28px] leading-none font-bold">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-muted">{sub}</p>}
    </Card>
  );
}

function Panel({ title, sub, children, className }: { title: string; sub?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cx("p-5 md:p-6", className)}>
      <div className="mb-4 flex items-baseline gap-2">
        <h3 className="font-bold">{title}</h3>
        {sub && <span className="text-xs text-muted">{sub}</span>}
      </div>
      {children}
    </Card>
  );
}

/** 열품타식 공부 달력 — 많이 할수록 진하게 */
function StudyMonth() {
  const { snap, settings } = usePlanner();
  const now = useNow(60_000);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const sessions = useMemo(() => liveStudy(snap.db), [snap.db]);
  const [sel, setSel] = useState<string | null>(null);
  const first = month;
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const secOf = (d: Date) => {
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), settings.dayStartHour).getTime();
    return { sec: sessions.length ? studyBySubjectTotal(sessions, s, now) : 0 };
  };
  const monthTotal = cells.filter((d) => d.getMonth() === month.getMonth()).reduce((n, d) => n + secOf(d).sec, 0);
  const selected = sel ? cells.find((d) => dayKey(d) === sel) : null;
  return (
    <Panel title="공부 달력" sub={`이번 달 ${fmtHM(monthTotal)}`}>
      <div className="mb-2 flex items-center justify-end">
        <IconButton label="이전 달" className="size-8" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          <ChevronLeft size={18} />
        </IconButton>
        <span className="min-w-[84px] text-center text-sm font-semibold">
          {month.getFullYear()}.{month.getMonth() + 1}
        </span>
        <IconButton label="다음 달" className="size-8" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          <ChevronRight size={18} />
        </IconButton>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted">
        {MON_FIRST.map((d) => (
          <span key={d}>{WEEKDAYS[d]}</span>
        ))}
        {cells.map((d) => {
          const k = dayKey(d);
          const { sec } = secOf(d);
          const inMonth = d.getMonth() === month.getMonth();
          return (
            <button
              key={k}
              type="button"
              aria-label={`${fmtDate(d)} ${fmtHM(sec)}`}
              onClick={() => setSel(k)}
              onMouseEnter={() => setSel(k)}
              className={cx("grid aspect-square place-items-center rounded-lg font-mono text-xs tabular-nums", !inMonth && "opacity-25", sel === k && "ring-2 ring-fg/70")}
              style={{ background: HEAT[studyLevel(sec)], color: studyLevel(sec) >= 3 ? "var(--accent-fg)" : undefined }}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{selected ? `${fmtDate(selected)} · ${fmtHM(secOf(selected).sec)}` : "날짜를 누르면 공부 시간"}</span>
        <HeatLegend low="0" high="5시간+" />
      </div>
    </Panel>
  );
}

function studyBySubjectTotal(sessions: ReturnType<typeof liveStudy>, from: number, now: number) {
  let n = 0;
  for (const v of studyBySubject(sessions, from, from + DAY, now).values()) n += v;
  return n;
}

export function MeTab({ onCareer }: { onCareer: () => void }) {
  const { tasks, snap, settings } = usePlanner();
  const [view, setView] = useState<"summary" | "study" | "records">("summary");
  const now = useNow(60_000);
  const today = useMemo(() => startOfDay(new Date(now)), [now]);
  const categories = useMemo(() => liveCategories(snap.db), [snap.db]);
  const sessions = useMemo(() => liveStudy(snap.db), [snap.db]);
  const subjects = useMemo(() => liveSubjects(snap.db), [snap.db]);
  const career = useMemo(() => liveCareer(snap.db), [snap.db]);

  const s = useMemo(() => {
    const byDay = completionsByDay(tasks);
    const doneAll = tasks.filter((t) => t.status === "done").length;
    const monthKey = dayKey(today).slice(0, 7);
    const doneMonth = [...byDay.entries()].filter(([k]) => k.startsWith(monthKey)).reduce((n, [, v]) => n + v, 0);
    const perfect = perfectDays(tasks, today);
    const rate = completionRate(tasks, new Date(now));
    const avg = weekdayAverages(byDay, today);
    const best = avg.some((x) => x > 0) ? avg.indexOf(Math.max(...avg)) : null;
    const monday = startOfWeek(today);
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(monday, i);
      return { d, n: byDay.get(dayKey(d)) ?? 0 };
    });
    // 30일 카테고리별 완료 — 5개 + 기타
    const from30 = addDays(today, -29).getTime();
    const cat = new Map<string, number>();
    for (const t of tasks) {
      if (t.status !== "done" || !t.completed_at || Date.parse(t.completed_at) < from30) continue;
      const k = t.category_id && categories.some((c) => c.id === t.category_id) ? t.category_id : "";
      cat.set(k, (cat.get(k) ?? 0) + 1);
    }
    const catRows = [...cat.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => {
        const c = categories.find((x) => x.id === k);
        return { key: k || "none", label: c?.name ?? "카테고리 없음", value: v, color: c ? COLOR_HEX[c.color] : "#94A3B8" };
      });
    const donut = catRows.length > 6 ? [...catRows.slice(0, 5), { key: "other", label: "기타", value: catRows.slice(5).reduce((n, r) => n + r.value, 0), color: "#64748b" }] : catRows;
    return { byDay, doneAll, doneMonth, perfect, rate, avg, best, week, donut };
  }, [tasks, today, categories, now]);

  // 공부는 '공부 하루'(dayStartHour 경계) 기준 — 새벽 1시는 아직 어제
  const studyToday = useMemo(() => startOfDay(studyDayStart(new Date(now), settings.dayStartHour)), [now, settings.dayStartHour]);
  const studyDays = useMemo(() => studyWeek(sessions, studyToday, settings.dayStartHour, now), [sessions, studyToday, settings.dayStartHour, now]);
  const studyTotalWeek = studyDays.reduce((n, x) => n + x, 0);
  const weekFrom = studyDayStart(new Date(startOfWeek(studyToday).getTime() + settings.dayStartHour * 3600_000), settings.dayStartHour).getTime();
  const subjWeek = useMemo(() => studyBySubject(sessions, weekFrom, weekFrom + 7 * DAY, now), [sessions, weekFrom, now]);
  const todayIdx = (today.getDay() + 6) % 7;
  const studyIdx = (studyToday.getDay() + 6) % 7;
  const bestWeek = s.week.reduce((m, x, i) => (x.n > s.week[m].n ? i : m), 0);
  const weekComment = s.week.every((x) => x.n === 0)
    ? "이번 주는 아직 끝낸 일이 없어요. 하나만 끝내도 시작이에요."
    : `이번 주는 ${WEEKDAYS[s.week[bestWeek].d.getDay()]}요일에 가장 많이 끝냈어요 (${s.week[bestWeek].n}개).`;

  const grid = useMemo(() => yearGrid(s.byDay, today), [s.byDay, today]);
  const heatWeeks = grid.map((w) => w.map((c) => ({ key: c.key, level: c.level, future: c.future, label: `${fmtDate(c.date)} · 완료 ${c.count}개` })));

  return (
    <div className="space-y-5">
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: "summary", label: "요약" },
          { value: "study", label: "공부" },
          { value: "records", label: "기록" },
        ]}
      />

      {view === "summary" && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="완료한 작업" value={s.doneAll.toLocaleString()} sub={`이번 달 ${s.doneMonth}개`} />
            <Tile label="완벽한 하루" value={`${s.perfect.perfect}일`} sub={s.perfect.streak ? `지금 ${s.perfect.streak}일 연속` : `기록된 ${s.perfect.tracked}일 중`} />
            <Tile label="완료율 (30일)" value={`${s.rate.rate}%`} sub={`${s.rate.done}/${s.rate.total}개`} />
            <Tile label="가장 생산적인 요일" value={s.best !== null ? `${WEEKDAYS[s.best]}요일` : "-"} sub="최근 8주 평균" />
          </div>
          <Panel title="요일별 완료" sub="이번 주">
            <Columns
              data={s.week.map((x) => ({ label: WEEKDAYS[x.d.getDay()], value: x.n, detail: `${fmtDate(x.d)} · ${x.n}개 완료` }))}
              format={(v) => `${v}개`}
              highlight={todayIdx}
            />
            <p className="mt-2 text-sm">{weekComment}</p>
          </Panel>
          <Panel title="카테고리별 완료" sub="최근 30일">
            {s.donut.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">최근 30일 동안 완료한 일이 없어요.</p>
            ) : (
              <Donut data={s.donut} format={(v) => `${v}개`} center={String(s.donut.reduce((n, d) => n + d.value, 0))} centerLabel="완료" />
            )}
          </Panel>
          <Panel title="1년 완료 기록" sub="많이 끝낸 날일수록 진하게">
            <YearHeatmap weeks={heatWeeks} readout={`최근 1년 완료 ${[...s.byDay.values()].reduce((n, v) => n + v, 0)}개`} />
          </Panel>
        </>
      )}

      {view === "study" && (
        <>
          <Panel title="이번 주 공부" sub={fmtHM(studyTotalWeek)}>
            <Columns
              data={studyDays.map((sec, i) => ({ label: WEEKDAYS[MON_FIRST[i]], value: sec, detail: `${fmtDate(addDays(startOfWeek(studyToday), i))} · ${fmtHM(sec)}` }))}
              format={(v) => fmtHM(v)}
              highlight={studyIdx}
            />
            {subjWeek.size > 0 && (
              <ul className="mt-4 space-y-2">
                {[...subjWeek.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([id, sec]) => {
                    const sub = subjects.find((x) => x.id === id) ?? (id ? snap.db.subjects[id] : null);
                    return (
                      <li key={id || "none"} className="flex items-center gap-2 text-sm">
                        <span className="size-2.5 rounded-sm" style={{ background: sub ? COLOR_HEX[sub.color] : "var(--accent)" }} />
                        <span className="min-w-0 flex-1 truncate">{sub?.name ?? "과목 없음"}</span>
                        <span className="font-mono text-xs tabular-nums">{fmtHM(sec)}</span>
                      </li>
                    );
                  })}
              </ul>
            )}
          </Panel>
          <StudyMonth />
        </>
      )}

      {view === "records" && (
        <>
          <Panel title="커리어 기록" sub={career.length ? `${career.length}개` : undefined}>
            {career.length === 0 ? (
              <p className="text-sm text-muted">했던 일을 남겨 두면 나중에 이력서 쓸 때 그대로 꺼내 써요. AI 가 일정·노트를 참고해 다듬어 줍니다.</p>
            ) : (
              <ul className="space-y-2">
                {career.slice(0, 5).map((e) => (
                  <li key={e.id} className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-muted tabular-nums">{e.start_day.slice(0, 7).replace("-", ".")}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{e.title}</span>
                  </li>
                ))}
              </ul>
            )}
            <button onClick={onCareer} className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-accent-text">
              <BriefcaseBusiness size={15} /> 커리어 기록 열기 →
            </button>
          </Panel>
          <HabitMini />
          <ReasonFeed />
        </>
      )}
    </div>
  );
}

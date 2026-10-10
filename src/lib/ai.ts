"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHabit, createTask, isTimed, liveHabits, liveTasks } from "./planner";
import type { PlannerStore } from "./store";
import { addDays, atTime, dayKey, fmtTime, MIN, parseDayKey, startOfDay, toHHMM, WEEKDAYS } from "./time";
import type { Category, DB, Habit, ScheduleKind, Settings, Task } from "./types";

/** parse-schedule 함수가 돌려주는 한 항목 (서버 logic.ts 의 clean() 결과와 같은 모양) */
export interface ParsedItem {
  title: string;
  kind: ScheduleKind;
  date: string | null;
  start: string | null;
  duration_min: number | null;
  repeat_days: number[];
  /** 기간이 있는 반복의 마지막 날("이번 달 매일" → 이달 말일). 없으면 계속 반복 */
  repeat_until?: string | null;
  category_id: string | null;
  starred: boolean;
  reminders_min: number[] | null;
  notes: string | null;
}

const MESSAGES: Record<string, string> = {
  bad_image: "이 사진은 읽을 수 없어요. JPG·PNG 사진으로 해 보세요.",
  image_too_big: "사진이 너무 커요. 다른 사진으로 해 보세요.",
  no_api_key: "AI 키가 아직 서버에 없어요. 설정 → AI 에서 넣는 방법을 확인하세요.",
  bad_api_key: "서버에 넣은 AI 키가 올바르지 않아요. 키를 다시 확인해 주세요.",
  rate_limited: "AI 요청이 잠깐 몰렸어요. 몇 초 뒤 다시 눌러 주세요.",
  daily_limit: "오늘 쓸 수 있는 AI 횟수를 다 썼어요. 내일 다시 쓸 수 있어요.",
  quota_check: "AI 사용량을 확인하지 못했어요. 잠시 뒤 다시 해 주세요.",
  refused: "AI 가 이 내용을 처리하지 않았어요. 표현을 바꿔 다시 말해 주세요.",
  too_long: "내용이 너무 길어요. 나눠서 말해 주세요.",
  unauthorized: "로그인이 풀렸어요. 다시 로그인해 주세요.",
};

/** 함수가 돌려준 오류 본문 {error, limit} */
async function errorBody(error: unknown): Promise<{ code: string; limit: number | null }> {
  const ctx = (error as { context?: Response }).context;
  if (!ctx || typeof ctx.json !== "function") return { code: "", limit: null };
  const j = (await ctx.json().catch(() => ({}))) as { error?: string; limit?: number };
  return { code: j.error ?? "", limit: typeof j.limit === "number" ? j.limit : null };
}

function message(code: string, limit: number | null): string | undefined {
  if (code === "daily_limit" && limit === 0) return "지금은 AI 기능이 꺼져 있어요(운영자 설정).";
  if (code === "daily_limit" && limit) return `오늘 쓸 수 있는 AI ${limit}회를 다 썼어요. 내일 다시 쓸 수 있어요.`;
  return MESSAGES[code];
}

export async function parseSchedule(
  client: SupabaseClient,
  text: string,
  categories: Category[],
  /** 사진 한 장(src/lib/photo.ts 로 줄인 것) — 있으면 글은 비워도 된다 */
  image?: { media_type: string; data: string },
  /** 지우기·옮기기 말이 있을 때만 — 기존 일정 목록(existingForAi) */
  existing?: ExistingForAi,
): Promise<{ items: ParsedItem[]; reply: string; remove: AiRemoval[] }> {
  const now = new Date();
  const { data, error } = await client.functions.invoke("parse-schedule", {
    body: {
      text,
      ...(image ? { image: { media_type: image.media_type, data: image.data } } : {}),
      ...(existing?.lines.length ? { existing: existing.lines } : {}),
      today: dayKey(now),
      time: toHHMM(now),
      categories: categories.map((c) => ({ id: c.id, name: c.name })),
    },
  });
  if (error) {
    const { code, limit } = await errorBody(error);
    throw new Error(message(code, limit) ?? (navigator.onLine ? "AI 정리에 실패했어요. 잠시 뒤 다시 해 주세요." : "인터넷이 끊겨 있어요."));
  }
  const out = data as { items: ParsedItem[]; reply: string; remove?: string[] };
  const remove = (out.remove ?? []).map((ref) => existing?.byRef.get(ref)).filter((x): x is AiRemoval => Boolean(x));
  return { items: out.items, reply: out.reply, remove };
}

/** AI 가 지우자고 고른 기존 일정 하나 */
export interface AiRemoval {
  kind: "task" | "habit";
  id: string;
  title: string;
  /** 사람이 읽는 언제 — '10/11(일) 15:00–16:00', '매일 07:00 (반복)' */
  when: string;
}

export interface ExistingForAi {
  lines: { ref: string; when: string; title: string }[];
  byRef: Map<string, AiRemoval>;
}

/** 지우기·옮기기 말인가 — 그때만 기존 일정 목록을 같이 보낸다(평소엔 AI 비용 그대로) */
export const REMOVE_RE = /지워|지우|지운|취소|삭제|빼\s?줘|빼고|빼 ?줘|없애|캔슬|그만|안\s?(가|해|할|함)|못\s?가|옮겨|옮기|미뤄|미루|바꿔|변경|cancel|delete|remove/i;

const md = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
const habitWhen = (h: Habit) =>
  `${h.days.length === 7 ? "매일" : `매주 ${[...h.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((x) => WEEKDAYS[x]).join("·")}`} ${h.start_time} (반복${h.end_day ? `, ~${Number(h.end_day.slice(5, 7))}/${Number(h.end_day.slice(8, 10))}` : ""})`;

/**
 * AI 에게 보여 줄 기존 일정 — 아직 안 끝낸 일정(그제 ~ 60일 뒤 + 날짜 없음)과 반복 습관, 가까운 것부터 최대 250개.
 * ref(t1·h1…)만 보내고, 실제 id 는 이 기기에만 둔다
 */
export function existingForAi(db: DB, now = new Date()): ExistingForAi {
  const from = addDays(startOfDay(now), -2).getTime();
  const to = addDays(startOfDay(now), 61).getTime();
  const tasks = liveTasks(db)
    .filter((t) => (t.status === "planned" || t.status === "in_progress") && (t.schedule === "someday" || (Date.parse(t.starts_at) >= from && Date.parse(t.starts_at) < to)))
    .sort((a, b) => Math.abs(Date.parse(a.starts_at) - now.getTime()) - Math.abs(Date.parse(b.starts_at) - now.getTime()))
    .slice(0, 220)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const habits = liveHabits(db).filter((h) => h.active).slice(0, 30);
  const lines: ExistingForAi["lines"] = [];
  const byRef = new Map<string, AiRemoval>();
  tasks.forEach((t, i) => {
    const d = new Date(t.starts_at);
    const when = t.schedule === "someday" ? "날짜 없음" : isTimed(t) ? `${md(d)} ${fmtTime(t.starts_at)}–${fmtTime(t.ends_at)}${t.habit_id ? " (반복 회차)" : ""}` : `${md(d)} 종일`;
    const ref = `t${i + 1}`;
    lines.push({ ref, when, title: t.title });
    byRef.set(ref, { kind: "task", id: t.id, title: t.title, when });
  });
  habits.forEach((h, i) => {
    const ref = `h${i + 1}`;
    const when = habitWhen(h);
    lines.push({ ref, when, title: h.title });
    byRef.set(ref, { kind: "habit", id: h.id, title: h.title, when });
  });
  return { lines, byRef };
}

/** 지난 시각의 시각 일정인가(반복 제외) — 넣자마자 '미시작' 경고가 뜨지 않게 따로 다룬다 */
export function isPastItem(it: ParsedItem, now = Date.now()): boolean {
  return !it.repeat_days.length && it.kind === "timed" && Boolean(it.date && it.start) && atTime(parseDayKey(it.date!), it.start!).getTime() < now;
}

/**
 * 미리보기에서 고른(또는 '쓰기'로 바로 넣는) 항목을 실제 일정·습관으로 저장하고 만든 것을 돌려준다.
 * strict 를 주면 시각 일정의 강제 모드를 그 값으로(지난 시각을 넣을 때 false — 바로 경고창이 뜨지 않게).
 */
export function saveParsed(
  store: PlannerStore,
  items: ParsedItem[],
  settings: Settings,
  categories: Category[],
  opts: { strict?: boolean } = {},
): { tasks: Task[]; habits: Habit[] } {
  const tasks: Task[] = [];
  const habits: Habit[] = [];
  for (const it of items) {
    const color = categories.find((c) => c.id === it.category_id)?.color ?? "lime";
    const reminders = it.reminders_min ?? undefined;
    const dur = it.duration_min ?? 30;
    if (it.repeat_days.length && it.start) {
      habits.push(
        createHabit(store, {
          title: it.title,
          color,
          days: it.repeat_days,
          start_time: it.start,
          duration_min: dur,
          reminder_offsets: reminders ?? settings.defaultOffsets,
          sound_id: null,
          strict: opts.strict ?? true,
          // 기간: 첫날이 앞날이면 그날부터, 끝나는 날이 있으면 그날까지("이번 달 매일")
          start_day: it.date && it.date > dayKey(new Date()) ? it.date : null,
          end_day: it.repeat_until ?? null,
        }),
      );
      continue;
    }
    const common = { title: it.title, notes: it.notes, color, category_id: it.category_id, starred: it.starred };
    if (it.kind === "timed" && it.date && it.start) {
      const s = atTime(parseDayKey(it.date), it.start);
      tasks.push(
        createTask(
          store,
          {
            ...common,
            schedule: "timed",
            starts_at: s.toISOString(),
            ends_at: new Date(s.getTime() + dur * MIN).toISOString(),
            reminder_offsets: reminders,
            strict: opts.strict,
          },
          settings,
        ),
      );
    } else if (it.kind !== "someday" && it.date) {
      tasks.push(createTask(store, { ...common, schedule: "day", day: it.date }, settings));
    } else {
      tasks.push(createTask(store, { ...common, schedule: "someday" }, settings));
    }
  }
  return { tasks, habits };
}

/** 서버에 AI 키가 들어 있는지만 확인(Claude 는 부르지 않음) */
export async function aiStatus(client: SupabaseClient): Promise<{ ready: boolean; model?: string }> {
  const { data, error } = await client.functions.invoke("parse-schedule", { body: { ping: true } });
  if (error) throw new Error(error.message);
  return data as { ready: boolean; model?: string };
}

export interface Polished {
  title: string;
  summary: string;
  bullets: string[];
  skills: string[];
}

/** 커리어 기록 다듬기 — 메모 + 그 기간의 일정·노트 → 이력서용 문장 */
export async function polishCareer(
  client: SupabaseClient,
  input: {
    title: string;
    kind: string;
    start_day: string;
    end_day: string | null;
    raw: string;
    events: { date: string; title: string; notes: string | null }[];
    notes: { day: string; body: string }[];
  },
): Promise<Polished> {
  const { data, error } = await client.functions.invoke("career-polish", { body: input });
  if (error) {
    const { code, limit } = await errorBody(error);
    if (code === "empty") throw new Error("메모를 적거나 관련 일정을 하나 이상 골라 주세요.");
    throw new Error(message(code, limit) ?? (navigator.onLine ? "AI 다듬기에 실패했어요. 잠시 뒤 다시 해 주세요." : "인터넷이 끊겨 있어요."));
  }
  return data as Polished;
}

"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHabit, createTask } from "./planner";
import type { PlannerStore } from "./store";
import { atTime, dayKey, MIN, parseDayKey, toHHMM } from "./time";
import type { Category, ScheduleKind, Settings } from "./types";

/** parse-schedule 함수가 돌려주는 한 항목 (서버 logic.ts 의 clean() 결과와 같은 모양) */
export interface ParsedItem {
  title: string;
  kind: ScheduleKind;
  date: string | null;
  start: string | null;
  duration_min: number | null;
  repeat_days: number[];
  category_id: string | null;
  starred: boolean;
  reminders_min: number[] | null;
  notes: string | null;
}

const MESSAGES: Record<string, string> = {
  no_api_key: "AI 키가 아직 서버에 없어요. 설정 → AI 에서 넣는 방법을 확인하세요.",
  bad_api_key: "서버에 넣은 AI 키가 올바르지 않아요. 키를 다시 확인해 주세요.",
  rate_limited: "AI 요청이 잠깐 몰렸어요. 몇 초 뒤 다시 눌러 주세요.",
  daily_limit: "오늘 쓸 수 있는 AI 횟수를 다 썼어요. 내일 다시 쓸 수 있어요.",
  quota_check: "AI 사용량을 확인하지 못했어요. 잠시 뒤 다시 해 주세요.",
  refused: "AI 가 이 내용을 처리하지 않았어요. 표현을 바꿔 다시 말해 주세요.",
  too_long: "내용이 너무 길어요. 나눠서 말해 주세요.",
  unauthorized: "로그인이 풀렸어요. 다시 로그인해 주세요.",
};

export async function parseSchedule(
  client: SupabaseClient,
  text: string,
  categories: Category[],
): Promise<{ items: ParsedItem[]; reply: string }> {
  const now = new Date();
  const { data, error } = await client.functions.invoke("parse-schedule", {
    body: {
      text,
      today: dayKey(now),
      time: toHHMM(now),
      categories: categories.map((c) => ({ id: c.id, name: c.name })),
    },
  });
  if (error) {
    let code = "";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      code = ((await ctx.json().catch(() => ({}))) as { error?: string }).error ?? "";
    }
    throw new Error(MESSAGES[code] ?? (navigator.onLine ? "AI 정리에 실패했어요. 잠시 뒤 다시 해 주세요." : "인터넷이 끊겨 있어요."));
  }
  return data as { items: ParsedItem[]; reply: string };
}

/** 미리보기에서 고른 항목을 실제 일정·습관으로 저장한다 */
export function saveParsed(store: PlannerStore, items: ParsedItem[], settings: Settings, categories: Category[]) {
  let tasks = 0,
    habits = 0;
  for (const it of items) {
    const color = categories.find((c) => c.id === it.category_id)?.color ?? "lime";
    const reminders = it.reminders_min ?? undefined;
    const dur = it.duration_min ?? 30;
    if (it.repeat_days.length && it.start) {
      createHabit(store, {
        title: it.title,
        color,
        days: it.repeat_days,
        start_time: it.start,
        duration_min: dur,
        reminder_offsets: reminders ?? settings.defaultOffsets,
        sound_id: null,
        strict: true,
      });
      habits++;
      continue;
    }
    const common = { title: it.title, notes: it.notes, color, category_id: it.category_id, starred: it.starred };
    if (it.kind === "timed" && it.date && it.start) {
      const s = atTime(parseDayKey(it.date), it.start);
      createTask(
        store,
        { ...common, schedule: "timed", starts_at: s.toISOString(), ends_at: new Date(s.getTime() + dur * MIN).toISOString(), reminder_offsets: reminders },
        settings,
      );
    } else if (it.kind !== "someday" && it.date) {
      createTask(store, { ...common, schedule: "day", day: it.date }, settings);
    } else {
      createTask(store, { ...common, schedule: "someday" }, settings);
    }
    tasks++;
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
    let code = "";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      code = ((await ctx.json().catch(() => ({}))) as { error?: string }).error ?? "";
    }
    if (code === "empty") throw new Error("메모를 적거나 관련 일정을 하나 이상 골라 주세요.");
    throw new Error(MESSAGES[code] ?? (navigator.onLine ? "AI 다듬기에 실패했어요. 잠시 뒤 다시 해 주세요." : "인터넷이 끊겨 있어요."));
  }
  return data as Polished;
}

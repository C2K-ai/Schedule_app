// 보낼지·배지 숫자 — 앱(src/lib/planner.ts)의 enforcementQueue·checkinQueue 와 같은 기준
//   · 미시작 경고(overdue)는 일정 시간 안에서만 — 끝난 일정은 앱을 열면 '이 일정 했나요?'로 묻는다
//   · 배지 = 지금 시간 안의 미시작 강제 일정 + 끝났는데 체크 안 한 일정(최근 7일)
//     날짜만 일정(schedule "day", 0시~다음 날 0시)도 그날이 지나면 '체크 안 한 일정'으로 센다

export interface BadgeRow {
  user_id: string;
  strict: boolean;
  /** "timed" | "day" — 날짜만 일정은 미시작 경고 대상이 아니다 */
  schedule?: string | null;
  starts_at: string;
  ends_at: string;
}

const DAY = 86_400_000;

/** 끝난 일정의 '시작 안 함' 알림은 보내지 않는다 */
export function skipEndedOverdue(kind: string, t: { ends_at: string }, now: number): boolean {
  return kind === "overdue" && now >= Date.parse(t.ends_at);
}

/** 사람마다 배지 숫자. rows = 상태 planned·시각/날짜만 일정·지운 것 빼고 */
export function badgeCounts(rows: BadgeRow[], now: number, graceMin: (userId: string) => number): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const start = Date.parse(r.starts_at);
    const end = Date.parse(r.ends_at);
    const ended = now >= end && now - end < 7 * DAY;
    const timed = (r.schedule ?? "timed") === "timed";
    const overdue = timed && r.strict && now >= start + graceMin(r.user_id) * 60_000 && now < end;
    if (ended || overdue) out.set(r.user_id, (out.get(r.user_id) ?? 0) + 1);
  }
  return out;
}

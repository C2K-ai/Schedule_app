"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

/*
 * 작은 차트 모음 — 막대 하나는 한 색(포인트색), 크기는 한 색의 진하기, 정체(카테고리)는 그 항목의 색.
 * 숫자는 막대 끝에만 고르게, 나머지는 눌러서(또는 올려서) 아래 한 줄에 보여 준다.
 */

/** 가는 세로 막대(≤24px), 끝만 4px 둥글게, 바닥선 하나. 값은 가장 큰 막대와 고른 막대 위에만 */
export function Columns({
  data,
  format,
  height = 140,
  highlight,
}: {
  data: { label: string; value: number; detail?: string }[];
  format: (v: number) => string;
  height?: number;
  /** 강조할 칸(예: 오늘) */
  highlight?: number;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const top = data.reduce((m, d, i) => (d.value > data[m].value ? i : m), 0);
  const shown = sel ?? highlight ?? null;
  return (
    <div>
      <div className="flex items-end gap-1 border-b border-line" style={{ height }} onMouseLeave={() => setSel(null)}>
        {data.map((d, i) => {
          const h = d.value ? Math.max(4, (d.value / max) * (height - 22)) : 0;
          const label = i === sel || (sel === null && d.value > 0 && i === top);
          return (
            <button
              key={i}
              type="button"
              aria-label={`${d.label} ${format(d.value)}`}
              onMouseEnter={() => setSel(i)}
              onFocus={() => setSel(i)}
              onClick={() => setSel(i)}
              className="flex h-full flex-1 flex-col items-center justify-end"
            >
              {label && <span className="mb-1 font-mono text-[11px] font-bold whitespace-nowrap text-fg tabular-nums">{format(d.value)}</span>}
              <span
                className={cx("w-full max-w-6 rounded-t-[4px] transition-opacity", sel !== null && sel !== i && "opacity-50")}
                style={{ height: h, background: i === highlight || i === sel ? "var(--accent)" : "color-mix(in oklab, var(--accent) 62%, var(--surface))" }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1">
        {data.map((d, i) => (
          <span key={i} className={cx("flex-1 text-center text-[11px]", i === highlight ? "font-bold text-fg" : "text-muted")}>
            {d.label}
          </span>
        ))}
      </div>
      <p className="mt-1 h-4 text-center text-xs text-muted">{shown !== null ? (data[shown].detail ?? `${data[shown].label} · ${format(data[shown].value)}`) : ""}</p>
    </div>
  );
}

/** 도넛 — 부분/전체 한눈에(6조각까지). 조각 사이 2px 틈, 범례에 이름·값·비율 */
export function Donut({
  data,
  format,
  center,
  centerLabel,
}: {
  data: { key: string; label: string; value: number; color: string }[];
  format: (v: number) => string;
  center: string;
  centerLabel: string;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const total = data.reduce((n, d) => n + d.value, 0);
  const size = 132;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = data.length > 1 ? 2 : 0;
  let acc = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`${centerLabel} ${center}`}>
          {total === 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="color-mix(in oklab, var(--fg) 7%, transparent)" strokeWidth={stroke} />}
          {total > 0 &&
            data.map((d) => {
              const len = (d.value / total) * c;
              const seg = (
                <circle
                  key={d.key}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={d.color}
                  strokeWidth={sel === d.key ? stroke + 4 : stroke}
                  strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                  strokeDashoffset={-acc}
                  onMouseEnter={() => setSel(d.key)}
                  onMouseLeave={() => setSel(null)}
                  onClick={() => setSel(d.key)}
                  className="cursor-pointer transition-[stroke-width]"
                />
              );
              acc += len;
              return seg;
            })}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-2xl leading-none font-bold">{center}</p>
            <p className="mt-1 text-[11px] text-muted">{centerLabel}</p>
          </div>
        </div>
      </div>
      <ul className="min-w-[150px] flex-1 space-y-1.5">
        {data.map((d) => (
          <li
            key={d.key}
            onMouseEnter={() => setSel(d.key)}
            onMouseLeave={() => setSel(null)}
            className={cx("flex items-center gap-2 text-sm transition-opacity", sel && sel !== d.key && "opacity-50")}
          >
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
            <span className="min-w-0 flex-1 truncate">{d.label}</span>
            <span className="font-mono text-xs tabular-nums">{format(d.value)}</span>
            <span className="w-9 text-right font-mono text-xs text-muted tabular-nums">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 한 색의 진하기 5단계 — 0 은 거의 안 보이는 칸 */
export const HEAT = [
  "color-mix(in oklab, var(--fg) 7%, transparent)",
  "color-mix(in oklab, var(--accent) 28%, var(--surface))",
  "color-mix(in oklab, var(--accent) 50%, var(--surface))",
  "color-mix(in oklab, var(--accent) 75%, var(--surface))",
  "var(--accent)",
];

export function HeatLegend({ low = "적음", high = "많음" }: { low?: string; high?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted">
      {low}
      {HEAT.map((c) => (
        <span key={c} className="size-2.5 rounded-[3px]" style={{ background: c }} />
      ))}
      {high}
    </span>
  );
}

/** 연간 히트맵 — 열 = 주(월요일 시작), 행 = 요일. 폰에선 가로로 밀어 보고, 처음엔 오른쪽 끝(최근)을 보여 준다 */
export function YearHeatmap({
  weeks,
  readout,
}: {
  weeks: { key: string; level: number; label: string; future: boolean }[][];
  readout: string;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  const all = weeks.flat();
  const shown = all.find((c) => c.key === sel);
  return (
    <div>
      <div ref={scroller} className="no-scrollbar overflow-x-auto">
        <div className="flex w-max gap-[3px]" onMouseLeave={() => setSel(null)}>
          {weeks.map((w, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {w.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-label={c.label}
                  title={c.label}
                  disabled={c.future}
                  onMouseEnter={() => setSel(c.key)}
                  onClick={() => setSel(c.key)}
                  className={cx("size-[11px] rounded-[3px] md:size-3", sel === c.key && "ring-2 ring-fg/70", c.future && "opacity-0")}
                  style={{ background: HEAT[c.level] }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{shown ? shown.label : readout}</span>
        <HeatLegend />
      </div>
    </div>
  );
}

"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { withBase } from "@/lib/base";
import { COLOR_HEX, COLOR_KEYS, type ColorKey } from "@/lib/types";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "soft" | "ghost" | "danger" | "outline" | "dangerSoft";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg hover:brightness-95 active:brightness-90 shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_6px_20px_-6px_color-mix(in_oklab,var(--accent)_60%,transparent)]",
  soft: "bg-surface-2 text-fg hover:bg-surface-3",
  ghost: "text-muted hover:text-fg hover:bg-surface-2",
  outline: "border border-line-strong text-fg hover:bg-surface-2",
  danger: "bg-danger text-white hover:brightness-110",
  dangerSoft: "bg-danger-soft text-danger hover:brightness-110",
};
const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-xl",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-5 text-[15px] gap-2 rounded-2xl",
};

export function Button({
  variant = "soft",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex select-none items-center justify-center font-semibold whitespace-nowrap transition disabled:opacity-40",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    />
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        "inline-flex size-10 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cx("rounded-3xl border border-line bg-surface shadow-card", className)}>{children}</section>
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <span className="text-[13px] font-semibold text-muted">{children}</span>
      {hint && <span className="text-xs text-faint">{hint}</span>}
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
  tone = "accent",
  className,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  tone?: "accent" | "danger";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "h-9 rounded-xl border px-3 text-[13px] font-semibold whitespace-nowrap transition",
        active
          ? tone === "danger"
            ? "border-danger bg-danger-soft text-danger"
            : "border-transparent bg-accent text-accent-fg"
          : "border-line bg-surface-2 text-muted hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cx("inline-flex rounded-xl bg-surface-2 p-1", className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-8 rounded-lg px-3 text-[13px] font-semibold whitespace-nowrap transition",
            value === o.value ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  desc?: ReactNode;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {desc && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{desc}</span>}
      </span>
      <span className="relative mt-0.5 shrink-0">
        <input
          id={id}
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="block h-6 w-11 rounded-full bg-surface-3 transition peer-checked:bg-accent" />
        <span className="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export function ColorPicker({ value, onChange }: { value: ColorKey; onChange: (c: ColorKey) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {COLOR_KEYS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          onClick={() => onChange(c)}
          className={cx(
            "size-8 rounded-full border-2 transition",
            value === c ? "scale-110 border-fg" : "border-transparent hover:scale-105",
          )}
          style={{ background: COLOR_HEX[c] }}
        />
      ))}
    </div>
  );
}

export const inputCls =
  "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[15px] text-fg placeholder:text-faint outline-none transition focus:border-accent focus:bg-surface";

/**
 * 모달 — 모바일은 아래에서 올라오는 시트, 데스크톱은 가운데 카드.
 * onClose 를 주지 않으면 닫을 수 없다(강제 모달).
 */
// 겹쳐 열린 창(모달·서랍) — Esc 는 맨 위 창만 닫고, 뒤 화면 스크롤 잠금은 마지막 창이 닫힐 때 푼다
const layers: number[] = [];
let layerSeq = 0;
let lockCount = 0;
let savedOverflow = "";

export function useLayer(active: boolean, onEscape?: () => void) {
  const escRef = useRef(onEscape);
  useEffect(() => {
    escRef.current = onEscape;
  });
  useEffect(() => {
    if (!active) return;
    const id = ++layerSeq;
    layers.push(id);
    if (lockCount++ === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && layers[layers.length - 1] === id) escRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = layers.indexOf(id);
      if (i >= 0) layers.splice(i, 1);
      if (--lockCount === 0) document.body.style.overflow = savedOverflow;
    };
  }, [active]);
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "md",
  tone = "default",
  className,
}: {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  tone?: "default" | "danger";
  className?: string;
}) {
  useLayer(open, onClose);

  if (!open) return null;
  const width = { sm: "md:max-w-md", md: "md:max-w-lg", lg: "md:max-w-2xl", xl: "md:max-w-4xl" }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6" role="dialog" aria-modal>
      <div
        className={cx(
          "absolute inset-0 backdrop-blur-sm",
          tone === "danger" ? "bg-[color-mix(in_oklab,var(--danger)_22%,rgba(0,0,0,0.7))]" : "bg-black/55",
        )}
        onClick={onClose}
      />
      <div
        className={cx(
          "sheet-in relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-line bg-surface shadow-2xl md:rounded-[28px]",
          width,
          tone === "danger" && "border-danger/60",
          className,
        )}
      >
        {(title || onClose) && (
          <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 md:px-6">
            <div className="min-w-0">
              {title && <h2 className="text-lg font-bold tracking-tight">{title}</h2>}
              {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
            </div>
            {onClose && (
              <IconButton label="닫기" onClick={onClose} className="-mt-1 -mr-2">
                <X size={20} />
              </IconButton>
            )}
          </header>
        )}
        <div className="flex-1 overflow-y-auto px-5 pb-5 md:px-6">{children}</div>
        {footer && <footer className="safe-bottom border-t border-line bg-surface px-5 py-3 md:px-6">{footer}</footer>}
      </div>
    </div>
  );
}

export function ProgressRing({
  value,
  size = 120,
  stroke = 12,
  color = "var(--accent)",
  track = "var(--surface-3)",
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.2,0.8,0.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- 정적 내보내기라 next/image 최적화를 못 쓴다 */}
      <img src={withBase("/icons/icon-192.png")} alt="" width={28} height={28} className="size-7 rounded-lg" />
      <span className="text-[17px] font-black tracking-[0.18em]">DREAM</span>
    </span>
  );
}

export function Empty({ icon, title, desc, action }: { icon: ReactNode; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="mb-1 grid size-12 place-items-center rounded-2xl bg-surface-2 text-muted">{icon}</div>
      <p className="font-semibold">{title}</p>
      {desc && <p className="max-w-xs text-sm text-muted">{desc}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

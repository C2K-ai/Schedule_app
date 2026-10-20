"use client";

// 커리어 '한눈에 보기' — 기록 전체를 한 장으로: 깔끔한 이력서 · 포트폴리오(AI 는 글만, 디자인은 앱) · AI 자유 디자인(HTML 통째로)
//   결과는 이 기기에 저장(다시 열 때 AI 를 또 부르지 않게). 미리보기는 잠근 틀(iframe sandbox + CSP) — 스크립트·바깥 주소 막힘

import { Download, Loader2, Printer, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { designCareer, visualizeCareer } from "@/lib/ai";
import {
  type CareerVisual as Visual,
  lockHtml,
  renderCareerHtml,
  visualInput,
  visualOrder,
  visualSignature,
  WISH_MAX,
} from "@/lib/careerVisual";
import { getSupabase } from "@/lib/supabase";
import { dayKey } from "@/lib/time";
import type { CareerEntry } from "@/lib/types";
import { usePlanner } from "./PlannerProvider";
import { Button, cx, inputCls, Segmented } from "./ui";

type Mode = "resume" | "portfolio" | "ai";

interface Cache {
  name?: string;
  /** 이력서·포트폴리오가 같이 쓰는 AI 글 — ids = 보낸 순서(AI 의 번호 n 이 1부터 가리키는 것) */
  visual?: { sig: string; ids: string[]; data: Visual; made: string };
  design?: { sig: string; wish: string; html: string; made: string };
}

const keyOf = (scope: string) => `must:v1:${scope}:career-visual`;
function readCache(scope: string): Cache {
  try {
    return JSON.parse(localStorage.getItem(keyOf(scope)) ?? "{}") as Cache;
  } catch {
    return {};
  }
}
function writeCache(scope: string, c: Cache) {
  try {
    localStorage.setItem(keyOf(scope), JSON.stringify(c));
  } catch {
    // 저장 공간이 꽉 차도 지금 화면은 그대로
  }
}

const dotDay = () => dayKey(new Date()).replaceAll("-", ".");
const LABEL: Record<Mode, string> = { resume: "이력서", portfolio: "포트폴리오", ai: "AI디자인" };

export function CareerVisual({ list }: { list: CareerEntry[] }) {
  const { session } = usePlanner();
  const scope = session.userId ?? "local";
  const [cache, setCache] = useState<Cache>(() => readCache(scope));
  const [mode, setMode] = useState<Mode>("resume");
  const [busy, setBusy] = useState<"visual" | "design" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wish, setWish] = useState(() => cache.design?.wish ?? "");
  const frame = useRef<HTMLIFrameElement>(null);

  const ordered = useMemo(() => visualOrder(list), [list]);
  const sig = useMemo(() => visualSignature(ordered), [ordered]);
  const update = (patch: Partial<Cache>) =>
    setCache((c) => {
      const next = { ...c, ...patch };
      writeCache(scope, next);
      return next;
    });

  const html = useMemo(() => {
    if (mode === "ai") return cache.design ? lockHtml(cache.design.html) : null;
    const v = cache.visual;
    if (!v) return null;
    // 만든 때의 순서(번호) 그대로 + 그 뒤에 새로 쓴 기록은 끝에(AI 한 줄 없이). 지운 기록은 빠진다
    const byId = new Map(list.map((e) => [e.id, e]));
    const atMake = v.ids.map((id) => byId.get(id) ?? null);
    const added = ordered.filter((e) => !v.ids.includes(e.id));
    return renderCareerHtml(v.data, [...atMake, ...added], mode, { name: cache.name?.trim() || undefined, made: v.made });
  }, [mode, cache, list, ordered]);

  const stale = mode === "ai" ? cache.design && cache.design.sig !== sig : cache.visual && cache.visual.sig !== sig;

  const client = () => {
    const sb = getSupabase();
    if (!sb || !session.userId) {
      setErr("AI 는 로그인한 상태에서만 쓸 수 있어요 (설정 → 계정).");
      return null;
    }
    return sb;
  };

  const makeVisual = async () => {
    const sb = client();
    if (!sb) return;
    setErr(null);
    setBusy("visual");
    const snapshot = ordered;
    try {
      const data = await visualizeCareer(sb, visualInput(snapshot));
      update({ visual: { sig: visualSignature(snapshot), ids: snapshot.map((e) => e.id), data, made: dotDay() } });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const makeDesign = async () => {
    const sb = client();
    if (!sb) return;
    setErr(null);
    setBusy("design");
    const snapshot = ordered;
    const w = wish.trim();
    try {
      const out = await designCareer(sb, visualInput(snapshot), w);
      update({ design: { sig: visualSignature(snapshot), wish: w, html: out, made: dotDay() } });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = () => {
    if (!html) return;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `커리어-${LABEL[mode]}-${dayKey(new Date())}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const print = () => frame.current?.contentWindow?.print();

  const made = mode === "ai" ? cache.design : cache.visual;
  const make = mode === "ai" ? makeDesign : makeVisual;

  return (
    <div className="space-y-3">
      <Segmented
        value={mode}
        onChange={(m) => {
          setMode(m);
          setErr(null);
        }}
        options={[
          { value: "resume", label: "깔끔한 이력서" },
          { value: "portfolio", label: "포트폴리오" },
          { value: "ai", label: "AI 자유 디자인" },
        ]}
      />
      <p className="text-xs text-muted">
        {mode === "ai"
          ? "AI 가 페이지를 통째로 디자인해요(30초~1분, AI 1회). 매번 모양이 달라요. 기록에 있는 사실만 써요."
          : "AI 가 한 줄 소개·대표 경험·항목별 한 줄·기술 묶음을 정리하고, 앱이 정해 둔 디자인으로 그려요(AI 1회, 이력서·포트폴리오가 같이 써요)."}
      </p>

      {mode === "ai" ? (
        <input
          value={wish}
          onChange={(e) => setWish(e.target.value.slice(0, WISH_MAX))}
          placeholder="원하는 느낌(선택) — 예: 파란색으로 차분하게, 개발자 포트폴리오처럼"
          className={inputCls}
          aria-label="원하는 느낌"
        />
      ) : (
        <input
          value={cache.name ?? ""}
          onChange={(e) => update({ name: e.target.value.slice(0, 30) })}
          placeholder="맨 위에 보일 이름(선택)"
          className={inputCls}
          aria-label="이름"
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={made ? "soft" : "primary"} onClick={() => void make()} disabled={busy !== null}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : made ? <RefreshCw size={16} /> : <Sparkles size={16} />}
          {busy === "design" ? "디자인하는 중…" : busy === "visual" ? "정리하는 중…" : made ? "다시 만들기" : "AI 로 만들기"}
        </Button>
        {html && (
          <>
            <Button size="sm" onClick={save}>
              <Download size={16} /> HTML 저장
            </Button>
            <Button size="sm" onClick={print}>
              <Printer size={16} /> 인쇄·PDF
            </Button>
          </>
        )}
      </div>

      {err && <p className="text-sm font-semibold text-danger">{err}</p>}
      {stale && !busy && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-warn">
          <TriangleAlert size={13} /> 만든 뒤 기록이 바뀌었어요 — &lsquo;다시 만들기&rsquo;를 누르면 새로 정리해요.
        </p>
      )}

      {html ? (
        <iframe
          ref={frame}
          title="커리어 미리보기"
          // 스크립트·폼·팝업·위 창 이동 없음. allow-same-origin 은 인쇄(부모가 print 호출)용 — 스크립트가 없어 앱에 손댈 수 없다
          sandbox="allow-same-origin allow-modals"
          srcDoc={html}
          className={cx("h-[68vh] w-full rounded-xl border border-line bg-white", busy && "opacity-50")}
        />
      ) : (
        <div className="grid h-48 place-items-center rounded-xl border border-dashed border-line text-sm text-muted">
          {busy ? "만드는 중이에요…" : "‘AI 로 만들기’를 누르면 여기에 미리보기가 나와요."}
        </div>
      )}
    </div>
  );
}

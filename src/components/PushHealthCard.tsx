"use client";

import { BellOff, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { requestNotificationPermission } from "@/lib/notify";
import { ensurePush, isPhone, onPushStatus, pushProblem, pushStatus, subscribePush } from "@/lib/push";
import { getSupabase } from "@/lib/supabase";
import { Button } from "./ui";
import { usePlanner } from "./PlannerProvider";

const HIDE_KEY = "must:push-card-hidden";

const hiddenThisRun = () => {
  try {
    return sessionStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * 폰에서 서버 푸시가 살아 있지 않으면 작업 탭 맨 위에 — 앱을 닫으면 일정 알림·아침 브리핑이 안 오니까.
 * 앱이 스스로 고칠 수 있는 건(죽은 구독 갈아끼우기) ensurePush 가 조용히 고치고, 사람이 눌러야 하는 것만 여기 뜬다.
 */
export function PushHealthCard() {
  const { session, openSheet } = usePlanner();
  const st = useSyncExternalStore(onPushStatus, pushStatus, pushStatus);
  const [phone] = useState(() => isPhone());
  const [hidden, setHidden] = useState(hiddenThisRun);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!session.userId || !phone || hidden) return null;
  if (st.state !== "ask" && st.state !== "blocked" && st.state !== "error") return null;

  const sb = getSupabase();
  const uid = session.userId;
  const fix = async () => {
    if (!sb) return;
    setBusy(true);
    setNote(null);
    try {
      if (st.state === "ask" && (await requestNotificationPermission()) !== "granted") {
        const now = await ensurePush(sb, uid);
        setNote(pushProblem(now) ?? "알림 권한이 필요해요");
        return;
      }
      if (st.state === "blocked") {
        const now = await ensurePush(sb, uid);
        if (now.state === "blocked") setNote("아직 차단돼 있어요 — 폰 설정에서 허용한 뒤 다시 눌러 주세요");
        return;
      }
      await subscribePush(sb, uid);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title = st.state === "blocked" ? "알림이 차단돼 있어요" : st.state === "error" ? "알림 등록이 안 됐어요" : "이 폰은 알림이 꺼져 있어요";
  const desc =
    st.state === "blocked"
      ? "폰 설정 → 애플리케이션 → DREAM(또는 Chrome) → 알림을 ‘허용’으로 바꾼 뒤 ‘다시 확인’을 눌러 주세요."
      : "켜 두면 앱을 닫아도 일정 알림과 아침 브리핑(오늘 일정 목록)이 와요.";

  return (
    <div className="fade-up flex items-start gap-3 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-warn/20 text-warn">
        <BellOff size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-muted">{desc}</p>
        {note && <p className="mt-1 text-warn">{note}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" disabled={busy || !sb} onClick={() => void fix()}>
            {busy ? "확인하는 중…" : st.state === "blocked" ? "다시 확인" : st.state === "error" ? "다시 시도" : "알림 켜기"}
          </Button>
          <button onClick={() => openSheet("settings", "notify")} className="text-sm font-bold text-accent-text">
            알림 설정 →
          </button>
        </div>
      </div>
      <button
        aria-label="닫기"
        className="text-muted hover:text-fg"
        onClick={() => {
          try {
            sessionStorage.setItem(HIDE_KEY, "1");
          } catch {
            /* 저장 못 해도 이번엔 닫기만 */
          }
          setHidden(true);
        }}
      >
        <X size={18} />
      </button>
    </div>
  );
}

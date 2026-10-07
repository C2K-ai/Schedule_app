"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// 브라우저 음성 인식(Web Speech API). 크롬(안드로이드·PC)·사파리에 있다. 표준 타입이 없어 필요한 만큼만 적는다.
interface RecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = () => ctor() !== null;

const ERRORS: Record<string, string> = {
  "not-allowed": "마이크 권한이 막혀 있어요 — 주소창의 자물쇠(또는 앱 정보)에서 마이크를 허용해 주세요.",
  "service-not-allowed": "이 브라우저에선 음성 인식을 쓸 수 없어요. 아래 칸에 직접 적어도 됩니다.",
  "audio-capture": "마이크를 찾지 못했어요.",
  network: "음성 인식 서버에 연결하지 못했어요(인터넷 확인).",
};

/**
 * 말하는 동안 글자를 계속 채워 준다. stop() 을 누를 때까지 듣는다.
 * 안드로이드 크롬은 continuous 모드에서 결과가 중복되는 버그가 있어, 한 문장씩 듣고 끝나면 이어서 다시 듣는다.
 */
export function useSpeech(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const wantRef = useRef(false);
  const committedRef = useRef("");
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  const stop = useCallback(() => {
    wantRef.current = false;
    recRef.current?.stop();
  }, []);

  /** 지금 화면의 글을 그대로 두고 듣기를 끝낸다 — 손으로 고치기 시작했거나 바로 AI 로 보낼 때(끝난 뒤 글을 되돌리지 않게) */
  const interrupt = useCallback(() => {
    wantRef.current = false;
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      rec.abort();
    }
    setListening(false);
  }, []);

  const start = useCallback((base: string) => {
    const C = ctor();
    if (!C) {
      setError(ERRORS["service-not-allowed"]);
      return;
    }
    setError(null);
    committedRef.current = base.trim();
    wantRef.current = true;
    const android = /Android/i.test(navigator.userAgent);

    const run = () => {
      const rec = new C();
      rec.lang = "ko-KR";
      rec.interimResults = true;
      rec.continuous = !android;
      let sessionFinal = "";
      rec.onresult = (e) => {
        let interim = "";
        sessionFinal = "";
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) sessionFinal += r[0].transcript;
          else interim += r[0].transcript;
        }
        const joined = [committedRef.current, (sessionFinal + interim).trim()].filter(Boolean).join(" ");
        onTextRef.current(joined);
      };
      rec.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") return;
        wantRef.current = false;
        setError(ERRORS[e.error] ?? `음성 인식 오류: ${e.error}`);
      };
      rec.onend = () => {
        committedRef.current = [committedRef.current, sessionFinal.trim()].filter(Boolean).join(" ");
        onTextRef.current(committedRef.current);
        if (wantRef.current) {
          try {
            run();
            return;
          } catch {
            wantRef.current = false;
          }
        }
        recRef.current = null;
        setListening(false);
      };
      recRef.current = rec;
      rec.start();
    };

    try {
      run();
      setListening(true);
    } catch {
      wantRef.current = false;
      setError(ERRORS["service-not-allowed"]);
    }
  }, []);

  // 화면을 닫으면 마이크도 끈다
  useEffect(
    () => () => {
      wantRef.current = false;
      recRef.current?.abort();
    },
    [],
  );

  return { listening, error, start, stop, interrupt };
}

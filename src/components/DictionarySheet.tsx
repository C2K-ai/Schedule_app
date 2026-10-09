"use client";

import { ExternalLink, Search, WifiOff, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, cx, inputCls, Modal } from "./ui";

/** 사전 종류 — 네이버 사전(영어·국어)을 앱 안에 띄운다(키·비용 없음, 인터넷이 있어야 함) */
export type DictLang = "en" | "ko";
const DICTS: { value: DictLang; label: string; hint: string; host: string }[] = [
  { value: "en", label: "영어사전", hint: "영어 단어·뜻(한글로 찾아도 돼요)", host: "en.dict.naver.com" },
  { value: "ko", label: "국어사전", hint: "우리말 뜻·띄어쓰기", host: "ko.dict.naver.com" },
];
const LANG_KEY = "must:dict-lang";
const RECENT_KEY = "must:dict-recent";
const RECENT_MAX = 8;

/** 작은 창용(미니) 사전 주소 — 찾을 말이 없으면 사전 첫 화면 */
export function dictUrl(lang: DictLang, q: string, mini = true): string {
  const host = DICTS.find((d) => d.value === lang)!.host;
  const word = q.trim();
  const route = mini ? "mini/" : "";
  return word ? `https://${host}/#/${route}search?query=${encodeURIComponent(word)}` : `https://${host}/#/${mini ? "mini/main" : "main"}`;
}

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 저장 못 해도 사전은 그대로 */
  }
};

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};
/** 인터넷 연결 여부(서버 렌더 땐 연결됨으로) */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** 사전 — 타이머 화면에서 바로 열어 영어·국어 단어를 찾는다 */
export function DictionarySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <DictionaryBody onClose={onClose} />;
}

function DictionaryBody({ onClose }: { onClose: () => void }) {
  const online = useOnline();
  const [lang, setLang] = useState<DictLang>(() => {
    const v = read<string>(LANG_KEY, "en");
    return v === "ko" ? "ko" : "en";
  });
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>(() => read<string[]>(RECENT_KEY, []).filter((x) => typeof x === "string").slice(0, RECENT_MAX));
  // 처음 열 때도 사전 첫 화면을 불러온다
  const [loading, setLoading] = useState(true);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 휴대폰에선 화면이 다 올라온 뒤에 키보드를 띄운다
    const t = window.setTimeout(() => input.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, []);

  const pickLang = (v: DictLang) => {
    if (v === lang) return;
    setLang(v);
    write(LANG_KEY, v);
    setLoading(true);
  };
  const search = (word: string) => {
    const w = word.trim().slice(0, 80);
    if (!w) return;
    setText(w);
    if (w !== query) setLoading(true);
    setQuery(w);
    const next = [w, ...recent.filter((x) => x !== w)].slice(0, RECENT_MAX);
    setRecent(next);
    write(RECENT_KEY, next);
  };
  const dict = DICTS.find((d) => d.value === lang)!;
  const src = dictUrl(lang, query);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="사전"
      subtitle={dict.hint}
      className="md:h-[86dvh]"
    >
      <div className="flex h-full min-h-[70dvh] flex-col gap-3 md:min-h-0">
        <div role="tablist" aria-label="사전 종류" className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1">
          {DICTS.map((d) => (
            <button
              key={d.value}
              role="tab"
              aria-selected={lang === d.value}
              onClick={() => pickLang(d.value)}
              className={cx(
                "h-10 rounded-xl text-sm font-bold transition",
                lang === d.value ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            search(text);
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Search size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
            <input
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={lang === "en" ? "예: persevere, 끈기" : "예: 성찰, 되레"}
              aria-label="찾을 말"
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={cx(inputCls, "pr-10 pl-10")}
            />
            {text && (
              <button
                type="button"
                aria-label="지우기"
                onClick={() => {
                  setText("");
                  input.current?.focus();
                }}
                className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-muted hover:text-fg"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <Button type="submit" variant="primary" disabled={!text.trim() || !online}>
            찾기
          </Button>
        </form>
        {recent.length > 0 && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" aria-label="최근 찾은 말">
            {recent.map((w) => (
              <button
                key={w}
                onClick={() => search(w)}
                className={cx(
                  "shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition",
                  w === query ? "border-accent bg-accent/15 text-accent-text" : "border-line text-muted hover:text-fg",
                )}
              >
                {w}
              </button>
            ))}
          </div>
        )}

        <div className="relative min-h-[52dvh] flex-1 overflow-hidden rounded-2xl border border-line bg-white md:min-h-0">
          {!online ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface px-6 text-center">
              <WifiOff size={26} className="text-muted" />
              <p className="font-semibold">인터넷이 연결되면 찾을 수 있어요</p>
              <p className="text-sm text-muted">사전은 네이버 사전을 불러와서 보여 줘요.</p>
            </div>
          ) : (
            <>
              <iframe
                key={src}
                title={`${dict.label} 검색 결과`}
                src={src}
                onLoad={() => setLoading(false)}
                referrerPolicy="no-referrer-when-downgrade"
                className="absolute inset-0 h-full w-full"
              />
              {loading && <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 animate-pulse bg-accent" />}
            </>
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-muted">
          <span>네이버 {dict.label}</span>
          <a
            href={dictUrl(lang, query, false)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold hover:bg-surface-2 hover:text-fg"
          >
            새 창에서 열기 <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </Modal>
  );
}

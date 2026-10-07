/* DREAM(예전 이름 MUST) 서비스 워커
 *  - push            : 서버 푸시 → 시스템 알림 + 열린 앱에 전달(앱이 자체 알람 소리를 울림)
 *  - notificationclick: "지금 시작" / "5분 뒤 다시" 버튼 처리 (잠금화면에서도 앱 안 열고 스누즈)
 *  - fetch           : 오프라인 캐시 (운영 빌드에서만)
 */
const VERSION = "must-v6";
const DEV = new URL(self.location.href).searchParams.get("mode") === "development";
// 하위 경로 배포(GitHub Pages /Schedule_app) 대응 — sw.js 가 놓인 폴더가 앱의 뿌리
const BASE = self.location.pathname.replace(/\/sw\.js$/, "");
const ROOT = `${BASE}/`;
const SHELL = [
  ROOT,
  `${BASE}/manifest.webmanifest`,
  `${BASE}/icons/icon-192.png`,
  `${BASE}/icons/icon-512.png`,
  `${BASE}/icons/badge-96.png`,
  `${BASE}/sounds/steel-rise.mp3`,
  `${BASE}/sounds/glass-ping.mp3`,
  `${BASE}/sounds/hit-alert.mp3`,
  `${BASE}/sounds/steel-calm.mp3`,
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  if (!DEV) {
    event.waitUntil(
      caches
        .open(VERSION)
        .then((c) => c.addAll(SHELL))
        .catch(() => undefined),
    );
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// ───────────── 오프라인 캐시 ─────────────
self.addEventListener("fetch", (event) => {
  if (DEV) return;
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase 등 외부 요청은 건드리지 않음

  // 페이지: 네트워크 우선, 실패하면 캐시(비행기 모드에서도 열림).
  // 브라우저 캐시(GitHub Pages 는 10분)도 건너뛰고 서버에 확인 — 배포하면 앱을 다시 열자마자 새 화면이 뜬다
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req, { cache: "no-cache" });
          const cache = await caches.open(VERSION);
          cache.put(ROOT, res.clone());
          return res;
        } catch {
          return (await caches.match(ROOT)) || Response.error();
        }
      })(),
    );
    return;
  }

  // 해시가 붙은 빌드 산출물: 캐시 우선
  if (url.pathname.startsWith(`${BASE}/_next/static/`)) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) (await caches.open(VERSION)).put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  // 나머지(아이콘·폰트·매니페스트): 캐시 먼저 보여주고 뒤에서 갱신
  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req);
      const net = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })(),
  );
});

// ───────────── 푸시 ─────────────
function buildOptions(p) {
  const urgent = p.kind === "start" || p.kind === "overdue" || p.kind === "snooze";
  return {
    body: p.body || "",
    tag: p.tag || undefined,
    renotify: Boolean(p.renotify && p.tag),
    requireInteraction: p.requireInteraction ?? urgent,
    vibrate: p.vibrate || [200, 100, 200],
    icon: `${BASE}/icons/icon-192.png`,
    badge: `${BASE}/icons/badge-96.png`,
    timestamp: p.startsAt ? Date.parse(p.startsAt) : Date.now(),
    data: p,
    actions: urgent
      ? [
          { action: "start", title: "▶ 지금 시작" },
          { action: "snooze", title: "⏱ 5분 뒤 다시" },
        ]
      : [{ action: "open", title: "열기" }],
  };
}

self.addEventListener("push", (event) => {
  let p = {};
  try {
    p = event.data ? event.data.json() : {};
  } catch {
    p = { title: "DREAM", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // 열려 있는 앱에 넘겨서 자체 알람 소리·전체화면 경고를 울리게 한다
      wins.forEach((w) => w.postMessage({ type: "must:push", payload: p }));
      await self.registration.showNotification(p.title || "DREAM", buildOptions(p));
      if (typeof p.badgeCount === "number" && self.navigator.setAppBadge) {
        try {
          await self.navigator.setAppBadge(p.badgeCount);
        } catch {
          /* 지원 안 함 */
        }
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  const p = event.notification.data || {};
  const action = event.action || "open";
  event.notification.close();
  event.waitUntil(
    (async () => {
      let handled = false;
      // 서버가 서명해 준 토큰이 있으면 앱을 열지 않고 바로 처리
      if ((action === "snooze" || action === "start") && p.actionUrl && p.actionToken) {
        try {
          const res = await fetch(p.actionUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: p.actionToken, action }),
          });
          handled = res.ok;
        } catch {
          handled = false;
        }
        if (handled && action === "snooze") {
          await self.registration.showNotification("⏱ 5분 뒤 다시 알려드릴게요", {
            body: p.title || "",
            tag: `${p.tag || "must"}-ack`,
            icon: `${BASE}/icons/icon-192.png`,
            badge: `${BASE}/icons/badge-96.png`,
            silent: true,
          });
          return;
        }
      }
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin) {
          w.postMessage({ type: "must:notification-action", action, taskId: p.taskId, handled, payload: p });
          if ("focus" in w) return w.focus();
          return;
        }
      }
      const q = new URLSearchParams({ from: "notification", action: handled ? "open" : action });
      if (p.taskId) q.set("task", p.taskId);
      return self.clients.openWindow(`${ROOT}?${q.toString()}`);
    })(),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // 브라우저가 구독을 갈아끼움 → 다음에 앱이 열리면 refreshPushSubscription() 이 다시 저장한다
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => wins.forEach((w) => w.postMessage({ type: "must:resubscribe" }))),
  );
});

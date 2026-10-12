/* DREAM(예전 이름 MUST) 서비스 워커
 *  - push            : 서버 푸시 → 시스템 알림 + 열린 앱에 전달(앱이 자체 알람 소리를 울림)
 *  - notificationclick: "지금 시작" / "5분 뒤 다시" 버튼 처리 (잠금화면에서도 앱 안 열고 스누즈)
 *  - fetch           : 오프라인 캐시 (운영 빌드에서만)
 *  - 잠금화면 카드    : 앱이 넘겨준 시점별 내용(lib/lockCard.ts)으로 '지금/다음 일정' 알림을 조용히 바꿔 단다
 */
const VERSION = "must-v10";
// 버전이 바뀌어도 지우지 않는 작은 저장소(잠금화면 카드 내용)
const STATE = "must-state";
// '공유 → DREAM' 으로 받은 사진·글을 앱이 꺼내 갈 때까지 잠깐 두는 곳
const SHARE = "must-share";
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
      await Promise.all(keys.filter((k) => k !== VERSION && k !== STATE && k !== SHARE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// ───────────── 공유받기(사진·글) ─────────────
// manifest share_target(POST multipart): 카톡·갤러리에서 '공유 → DREAM' 한 사진(image)과 글(title·text·url)을
// SHARE 캐시에 두고 앱을 ?shared=1 로 연다 — 앱(ReminderEngine)이 꺼내서 Write 창에 채운다
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "POST" || new URL(req.url).pathname !== `${BASE}/share-target`) return;
  event.respondWith(
    (async () => {
      try {
        const form = await req.formData();
        const cache = await caches.open(SHARE);
        await cache.delete(`${BASE}/__shared/image`);
        // 사진 한 장, 20MB 까지만(다른 사이트가 큰 파일을 밀어 넣어 기기 저장 공간을 채우지 못하게)
        const file = form.getAll("image").find((f) => typeof f !== "string" && f.size > 0 && f.size <= 20 * 1024 * 1024 && /^image\//.test(f.type));
        if (file) await cache.put(`${BASE}/__shared/image`, new Response(file, { headers: { "content-type": file.type } }));
        const text = {};
        for (const k of ["title", "text", "url"]) {
          const v = form.get(k);
          if (typeof v === "string" && v.trim()) text[k] = v.slice(0, 4000);
        }
        await cache.put(`${BASE}/__shared/text`, new Response(JSON.stringify(text), { headers: { "content-type": "application/json" } }));
      } catch {
        /* 못 받으면 빈 Write 창 */
      }
      return Response.redirect(`${ROOT}?shared=1`, 303);
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
          // 앱 첫 화면이 제대로 왔을 때만 오프라인용으로 저장 — 없는 주소(404)를 열어도 오프라인 화면이 404 로 바뀌지 않게
          if (res.ok && res.type === "basic" && new URL(req.url).pathname === ROOT) {
            const cache = await caches.open(VERSION);
            cache.put(ROOT, res.clone());
          }
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

// ───────────── 잠금화면 카드 ─────────────
const LOCK_TAG = "lock-card";
const LOCK_KEY = `${ROOT}__state/lock-card`;

async function loadLock() {
  try {
    const res = await (await caches.open(STATE)).match(LOCK_KEY);
    return res ? await res.json() : [];
  } catch {
    return [];
  }
}

async function saveLock(steps) {
  const cache = await caches.open(STATE);
  await cache.put(LOCK_KEY, new Response(JSON.stringify(steps), { headers: { "content-type": "application/json" } }));
}

/** 지금 시각에 맞는 카드를 단다 — 같은 내용이 이미 떠 있으면 그대로 둔다(맨 위로 다시 올라오지 않게) */
async function drawLock(steps) {
  const now = Date.now();
  let face = null;
  for (const s of steps) {
    if (s.at > now) break;
    face = s.face;
  }
  const open = await self.registration.getNotifications({ tag: LOCK_TAG });
  if (!face) {
    open.forEach((n) => n.close());
    return;
  }
  if (open.some((n) => n.title === face.title && n.body === face.body)) return;
  await self.registration.showNotification(face.title, {
    body: face.body,
    tag: LOCK_TAG,
    silent: true,
    renotify: false,
    icon: `${BASE}/icons/icon-192.png`,
    badge: `${BASE}/icons/badge-96.png`,
    data: { kind: "lock" },
    actions: [
      { action: "open", title: "열기" },
      { action: "voice", title: "🎙 말로 추가" },
    ],
  });
}

const refreshLock = () => loadLock().then(drawLock).catch(() => undefined);

self.addEventListener("message", (event) => {
  const d = event.data || {};
  if (d.type === "must:lock-card" && Array.isArray(d.steps)) {
    event.waitUntil(saveLock(d.steps).then(() => drawLock(d.steps)).catch(() => undefined));
  }
});

// 크롬이 가끔 깨워 줄 때(설치한 앱) — 앱을 안 열어도 카드가 시간에 맞게 바뀐다
self.addEventListener("periodicsync", (event) => {
  if (event.tag === LOCK_TAG) event.waitUntil(refreshLock());
});

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
      // 푸시가 올 때마다(알림 시각·아침 브리핑) 잠금화면 카드도 지금 시각에 맞게
      await refreshLock();
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
  // 본문을 누르면 openAction(예: 가입 신청 알림 → 관리자 화면), 없으면 그냥 열기
  const action = event.action || p.openAction || "open";
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

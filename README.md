# MUST — 미루지 못하는 플래너

> 일정을 어기면 **빨갛게 경고하고**, 미루려면 **사유를 쓰게** 만드는 습관·일정 플래너.
> 노트북과 핸드폰에 앱처럼 설치되고(PWA), 정각·미시작 알림이 **앱을 닫아도** 옵니다.

| 노션·일반 캘린더의 약점 | MUST 의 보완 |
|---|---|
| 일정을 어겨도 아무 일 없음 | 유예 시간(기본 5분)이 지나면 **닫을 수 없는 빨간 경고창**. 시작하거나, 사유 10자 이상 쓰고 미루거나 건너뛰기. 사유는 지울 수 없는 ‘변명 노트’에 남고, 자주 쓰는 변명을 모아 보여 줌 |
| 알림이 약하거나 늦음 | 3중 알림 — ① 앱 안 엔진(초 단위, 전체화면 알람 + 자체 알람음 + 음성) ② 서버 Web Push(앱이 꺼져도) ③ 미시작이면 +5·+15·+30분 세 번 점점 세게. 같은 알림은 tag 로 한 번만 |
| 지금 뭘 해야 하는지 안 보임 | 맨 위에 항상 **지금 하는 일 · 다음 일정까지 카운트다운 · 오늘 달성률** |
| 노트북 ↔ 폰 따로 놂 | 로컬 우선 저장 + Supabase Realtime. 오프라인(비행기)에서도 쓰고, 연결되면 밀린 변경이 자동으로 올라감 |

## 기능

- **대시보드** — 지금/다음/달성률 카드, 일·주 타임라인(끌어서 이동, 아래 끝 끌어 길이 조절, 모바일은 길게 눌러 끌기), 주간 달성률 막대
- **강제 시스템** — 미시작 경고창(대기열·일괄 기록), 시작 시각 지난 일정을 끌어서 미는 것도 ‘미루기’로 취급, 건너뛴 것도 달성률 분모에 남음, N회 이상 미루면 압박 문구
- **알림** — N분 전/정각/미시작, 5분 스누즈, 앱 아이콘 배지, 탭 제목 깜빡임, 진동 패턴 6종, 일정 제목 음성 안내(TTS)
- **소리** — CC0 녹음 음원 20종(스틸드럼·피치카토·8비트·색소폰…) + 합성음 8종 + **사운드 스튜디오**(16스텝 시퀀서로 직접 작곡) · 알림 종류별/일정별 지정 · 파일로 내보내 안드로이드 알림음으로 지정
- **집중 모드** — 뽀모도로(집중/짧은·긴 휴식 자동 전환), 방해금지(사전 알림 음소거), 화면 꺼짐 방지, 중단하려면 사유
- **습관** — 요일·시각 반복, 자동 회차 생성(서버가 미리 만들어 앱을 안 열어도 알림), 연속 기록(🔥 스트릭), 14일 히트맵
- **기록** — 주간 리포트, 미룸·건너뜀·놓침·집중 중단 사유 목록, 자주 쓰는 변명 Top 5
- **기타** — 다크/라이트, 백업 내보내기·가져오기(JSON), 로컬 데이터 → 계정으로 옮기기

## 빠른 시작 (로컬 모드 — 서버 없이 바로)

```bash
npm install
npm run dev
```

http://localhost:3000 — Supabase 키가 없으면 이 기기(브라우저)에만 저장하는 **로컬 모드**로 동작합니다.
앱(탭)이 열려 있는 동안은 알림·알람이 모두 동작합니다.

## 다음 단계

1. **노트북 ↔ 폰 동기화 + 앱이 꺼져도 오는 푸시** → [docs/SETUP-SUPABASE.md](docs/SETUP-SUPABASE.md)
2. **폰·노트북에 설치하고 알림을 놓치지 않게 설정** → [docs/PWA-NOTIFICATIONS.md](docs/PWA-NOTIFICATIONS.md)
3. **기술 스택·DB 스키마·동기화/알림 구조** → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## 스크립트

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 (http://localhost:3000) |
| `npm run build` | 정적 빌드 → `out/` (어느 정적 호스팅에나 올릴 수 있음) |
| `npm run serve` | `out/` 를 http://localhost:4173 으로 띄움 — 서비스 워커·오프라인·설치까지 시험 |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript 검사 |
| `npm run test:db` | DB 스키마 테스트 — 실제 Postgres(PGlite)에서 트리거·RLS·습관 생성 25개 항목 |
| `npm run vapid` | Web Push 키와 서버 비밀값 생성 |
| `npm run icons` | 앱 아이콘 다시 그리기 |

Edge Function 테스트(Deno 필요): `cd supabase/functions && deno test --allow-net --allow-env _shared/push.test.ts`
— 버튼 토큰 서명/검증, 알림 문구, **web-push 암호문을 브라우저처럼 복호화(RFC 8291)** 까지 확인합니다.

## 폴더 구조

```
src/
  app/                  layout · page · manifest(PWA) · globals.css(디자인 토큰)
  components/           Dashboard, NowBar, Timeline, Enforcement(경고창), AlarmOverlay,
                        Focus(뽀모도로), TaskEditor, Settings·SoundStudio·Habits·Log 시트,
                        ReminderEngine(앱 안 알림 엔진), PlannerProvider(상태)
  lib/
    store.ts            로컬 우선 저장소 + outbox + Supabase 동기화(LWW, Realtime, 델타 pull)
    planner.ts          선택자·동작(시작/완료/미루기/건너뛰기/습관/집중)
    reminders.ts        알림 시점 계산(서버와 같은 규칙)
    sound.ts            사운드 엔진(음원 + 합성 + WAV 렌더)
    notify.ts push.ts   시스템 알림·서비스 워커·Web Push 구독
public/
  sw.js                 서비스 워커(푸시·알림 버튼·오프라인 캐시)
  sounds/               CC0 알람 음원
  icons/                앱 아이콘(scripts/gen-icons.mjs 로 생성)
supabase/
  migrations/           스키마·RLS·트리거·함수 / pg_cron 예약
  functions/            send-due-notifications · notification-action · push-test (Deno)
  tests/                PGlite 스키마 테스트
scripts/                gen-icons · gen-vapid · serve
```

## 크레딧

- 알람 음원: [Kenney](https://kenney.nl) — Music Jingles, Interface Sounds (CC0). 원본 대응표는 `public/sounds/LICENSE.txt`
- 글꼴: [Pretendard](https://github.com/orioncactus/pretendard) (SIL OFL 1.1)
- 아이콘: [Lucide](https://lucide.dev) (ISC)

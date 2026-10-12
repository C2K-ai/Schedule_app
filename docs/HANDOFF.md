# DREAM 인수인계 (2026-10-08 기준)

> 새 계정·새 세션에서 이 앱을 이어서 고칠 때 **이 파일부터** 읽으세요. 기능별 자세한 기록은 `docs/REVAMP-HANDOFF.md`,
> 구조는 `docs/ARCHITECTURE.md`, 알림은 `docs/PWA-NOTIFICATIONS.md`, 서버 처음 설정은 `docs/SETUP-SUPABASE.md`.

## 0. ⚠️ 지금 상태 — 2026-10-11 갱신 (여기부터 읽기)

**브랜치**: `ui-revamp` = `main`(2026-10-11: 표시(생일·기념일) + Write/말로 추가에서 표시로까지 배포). 끝난 일은 8절.

### 0-0. 일기 책 애니메이션 — 다듬기 배포함(2026-10-10), **사용자 폰 확인 대기**
사용자 지적 두 가지(닫기가 너무 짧음 · 폰에서 심하게 버벅임)를 고쳐 배포함. 사용자가 써 보고 말하면 그 부분만 고친다(큰 진단·심사 다시 돌리지 말 것).
- **닫기(사용자가 고른 모양 "끝까지 넘겨 뒷표지")**: 종이가 오른쪽 페이지로 작아짐 → 남은 장이 촤라락 왼쪽으로 → 뒷표지(`.di-bcover`:
  판 + 안쪽 면지 `.di-bin` + 바깥 DIARY)가 책등 축으로 넘어와 덮임(`backAngle`) → DIARY 반짝 → 앱 위로 스르르(`CLOSE.exit`). 1.46초 → 2.68초, 뒤집기 없음.
  닫는 동안 밑의 일기 화면은 `onCovered`(CLOSE.covered 110ms) 때 `invisible` → 끝에 앱이 비쳐 보임(DiaryIntro 장면은 `visible` 로 남김).
- **버벅임**: 빛 캔버스 1배 이하(폰 뒤 0.75·앞 0.9), 앞 캔버스 `mix-blend-mode: screen` 뺌, 폰은 넘어가는 장 7(닫기 6)·띠 6(PC 10·10),
  투명도 바뀌는 막(.di·warm·vignette·veil·pglow)에 will-change, 무늬(가죽·디더·빛 조각) 문서마다 한 번 만들어 캐시 + `preloadDiaryIntro()`
  (Shell: 앱 뜨고 2.5초 뒤 한가할 때, 서랍 열 때), 시계는 첫 장면이 그려진 다음 프레임부터·한 프레임 최대 50ms(멈칫해도 장면을 안 건너뜀),
  처음 8~30프레임 중 5번 넘게 26ms 넘으면 빛 조각 절반(`trim`).
- **측정(Playwright, 390x844 DPR3, CPU 4배 느림, 같은 조건 두 번)**: 열기 긴 작업 22~25개·합계 약 2초 → 4~6개·0.57초, 50ms 넘는 프레임 20~23 → 5~11.
  닫기 긴 작업 10개·0.8초 → 3~4개·0.3초, 가장 긴 프레임 0.2~0.27초 → 0.12초. 헤드리스는 합성을 CPU 로 해서 fps 자체는 폰과 다름 — 긴 작업·메인 스레드로 비교.
  재는 법: 빌드 `out/` 를 **루트로** 서빙(`cd out && python3 -m http.server 3201`, basePath 는 CI 에서만 붙음), rAF 시각·longtask 를 addInitScript 로 모으고
  CDP `Performance.getMetrics` 앞뒤 차이. 열기 첫 긴 작업(약 0.25~0.3초, 일기 화면 React 렌더 + 엔진 DOM)은 남음 — 더 줄이려면 여기.
- **2026-10-10 2차(사용자: "폰에서 여전히 버벅임 → 반짝이 줄여")**: 폰·터치(`mobile` = 640px 미만 또는 pointer: coarse)는 반짝이·먼지 0,
  빛줄기 10, 캔버스 뒤 0.5·앞 0.6배, 장 5(닫기 4)·띠 4, 표지 박 빛 멈춤, 장 그늘 1/20 단위. DREAM 누르면 `openDiaryWithVeil` 이 바로 어둡게 깔고
  두 프레임 뒤 일기 화면을 엶(엔진이 붙으면 걷음, 2초 안전장치). 폰 조건 측정: 열기 메인 스레드 2.6초 → 2.1초, 가장 긴 멈춤 0.25 → 0.15초,
  닫기 1.9 → 1.3~1.6초. **사용자 폰 확인 대기.**
- 설치 안 뜸(사용자 문의): 빌드는 설치 가능(Page.getInstallabilityErrors 에 시크릿 창 말고는 오류 없음). 이미 설치했거나 카카오톡 등 앱 안 브라우저일 가능성
  → 할 일 탭 설치 힌트 카드가 앱 안 브라우저면 '설치가 안 돼요 → Chrome으로 열기'(kakaotalk://web/openExternal, 안드로이드 intent) 안내.
- 남은 다듬을 점(사용자가 원하면): `docs/design/diary-intro/POLISH-REVIEW.md` — 표지 안쪽 점 무늬(스피커 망 같음), 넘어가는 장 끝이 뾰족, 빛기둥이 촛불 같음,
  PC 표지가 위로 잘림 등. 금박 책배 줄무늬(모아레)는 완화함.
- **아이폰**: WebKit 이 없어 직접 못 봄. 섞기 모드를 줄여 Safari 쪽 위험은 줄었지만 사용자(또는 아이폰 가진 사람) 확인 필요.

### 0-3. 사용자에게 준 링크(사용자 claude.ai 계정 소유 Artifact)
- 애니메이션 미리보기: https://claude.ai/artifact/3MLTmoRmJuWrRpVNphXwhf
- 진행률 페이지: https://claude.ai/artifact/6sH8vdW4FcEFsLpnzu9xec
- 다른 계정에선 공유받지 않으면 못 열고, 고쳐 올리려면 편집 권한이 필요 — 안 되면 새 Artifact 로 올리고 사용자에게 새 링크를 줄 것.

### 0-4. 그 밖의 대기 · 사용자 확인 대기
- 2026-10-10 사용자: **모든 권한을 줄 테니 허락 묻지 말고 과업이 끝날 때까지 계속하라**고 함(서버·Supabase 작업 포함).
  단 Claude 가 `.claude/settings.json` 권한을 스스로 넓히는 건 자동 모드 분류기가 막음(자기 수정) — 승인 창은 사용자가 '항상 허용'.
- **사용자가 직접 확인할 것**(배포는 끝남): ① 폰에서 일기 책 애니메이션 끊김(0-0) ② 아이폰에서 애니메이션 모양 ③ 카톡 메시지 '공유 → DREAM'
  (홈 화면에 설치한 안드로이드 앱만) ④ Write 사진 버튼으로 시간표 사진 넣기(로그인 필요, 실제 AI 호출은 아직 안 해 봄) ⑤ PC 캘린더 탭 주/일 → 오른쪽 인박스 끌어 놓기.
  ⑥ Voice/Write 로 "내일 치과 취소해줘"(지우기 확인 창) ⑦ "이번 달 매일 …" → 달 끝까지 들어가는지(8절 23·24) ⑧ Write 에 "내일 내 생일"·"20일부터 23일까지 제주 여행" → 일정이 아니라 표시로(8절 30, 모델은 시험 통과 — 폰 화면에서 한 번).
  ⑨ 캘린더 → 시간표 → '사진으로 넣기'에 실제 에타·포털 캡처(8절 31) — 미리보기에서 시각이 맞는지, 학기 기간이 맞는지.
  ⑩ 홈 화면 앱에서 카톡·갤러리 사진 '공유 → DREAM'(8절 32 — 설치된 앱의 공유 설정이 새 manifest 로 바뀌는 데 하루쯤 걸릴 수 있음), 폰 '붙여넣기' 버튼.
- 잠금화면 카드가 사용자 폰에서 안 보이는 문제(7절 '이어서 할 것') — 사용자가 "나중에" 하자고 함.
- 도구: Deno 는 `npm i --no-save deno`(또는 스크래치에), Playwright 는 `npm i playwright-core@1.56.1` + `executablePath: '/opt/pw-browsers/chromium'`.
  화면 확인: `npx next build` → `cd out && python3 -m http.server 3201`(루트로 서빙) → Playwright. 캘린더 탭 → '주' 에서 시간표·인박스.
- 사용자 방식: 오래 걸리는 일은 진행률을 알려 주길 원함(1분마다 보고 요청한 적 있음), 완료되면 PushNotification.
- 이 세션은 Opus 5.5·노력 xhigh·울트라코드 켜짐이었음(프로젝트 기본 Sonnet 설정은 새 세션부터). 큰 워크플로는 한도에 걸린 적 있으니 작게.

### 0-5. 다음에 만들 기능 — **5개 모두 끝(8절 18~21·27)**. 새 요청을 기다림.
- 사용자(2026-10-10 밤): "폰에서 일기 애니메이션이 깨진다"(화질 올려도 여전히) → **폰은 녹화 영상으로 바꿈**: 세로 터치 화면이면
  `public/diary/open.mp4`·`close.mp4`(엔진을 `quality: "high"` 로 장면마다 찍은 H.264 1080x2336 60fps, 1.3/1.1MB)를 틀고 끝에 진짜 화면으로 페이드.
  영상은 앱이 한가할 때 blob 으로 받아 둠(못 받았거나 1.5초 안에 못 틀면 엔진). 다시 만드는 법 `scripts/diary-video/README.md`
  — **표지 연도 '2026'이 영상에 박혀 있어 해가 바뀌면 다시 녹화**. 테스트 Chromium 은 H.264 를 못 틀어 시험 때만 WebM 으로 바꿔 끼워 확인함.
  **2026-10-10 사용자 폰에서 확인: "잘 된다"**(세로 = 영상, 가로 = 엔진 둘 다). 처음엔 영상을 받기 전이라 엔진이 나와 깨져 보였을 수 있음. PC·가로 화면은 그대로 엔진.
- 관리자 계정에 **시험용 구글 캘린더 구독 주소 1개**가 남아 있음(토큰은 출력한 적 없어 아무도 모름). 지우는 SQL 은 MCP 승인 창에서 멈춤 →
  관리자가 설정 → '구글 캘린더에서 보기' → '끄기'로 지우면 됨.

## 1. 한눈에

- **DREAM**(예전 이름 MUST) — 개인 플래너 PWA. 폰·PC에 설치해서 쓴다. 일정·습관·공부 타이머·커리어 기록·드라이브·알림·AI.
- 주소: https://c2k-ai.github.io/Schedule_app/ (GitHub Pages, `main` 에 push 하면 자동 배포 — `.github/workflows/pages.yml`)
- 저장소: `C2K-ai/schedule_app` · 작업 브랜치 `ui-revamp` → 배포 브랜치 `main`
  (`bg-fetch`·`bg-results` 는 배경 사진 받기용 보조 브랜치, 지워도 됨 — 프록시가 원격 브랜치 삭제를 막아 남아 있음)
- 서버: Supabase 프로젝트 **`gcnosxcojuefkaaxefug`** (DB·Auth·Storage·Edge Functions·pg_cron·pg_net·Vault)
- 관리자(주인): 첫 가입자 = 자동 관리자(공개 저장소라 메일 주소는 적지 않음 — 2026-10-11 보안 점검)

## 2. 사용자와 일하는 방식 (중요)

- **한국어로** 답한다. 쉬운 말로, 결과 위주로.
- **허락 묻지 말고 끝까지 해서 배포한 뒤 보고**. 중간에 확인 질문 하지 말 것.
- 사용자가 직접 눌러야 하는 게 생기면 **PushNotification(소리 알림)** 으로 알린다.
- 커밋 작성자: `--author "C2K-ai <338173723+C2K-ai@users.noreply.github.com>"`, 커밋 메시지는 한국어로 무엇이 바뀌었는지.
- 배포 순서: `git push origin ui-revamp` → `git push origin ui-revamp:main` → `gh run list --workflow pages.yml` 로 성공 확인.
- 코드 주석·문구는 한국어, 짧고 친절하게(주변 코드와 같은 말투). 화면 문구는 "~해요" 체.

## 3. 기술 스택·폴더

- Next.js 16(정적 내보내기, `basePath=/Schedule_app`) · React 19 · Tailwind 4 · TypeScript.
  **AGENTS.md: 이 Next.js 는 학습 데이터와 다르다 — 바꾸기 전에 `node_modules/next/dist/docs/` 를 읽을 것.**
- ESLint 가 `react-hooks` 의 `set-state-in-effect`·`purity`(렌더 중 Math.random/Date.now 금지)·`immutability` 를 검사한다.
- 데이터: 로컬 우선(`src/lib/store.ts` PlannerStore, localStorage 키 `must:`) + 로그인하면 Supabase 와 동기화(LWW, `updated_at`).
- `src/components/` 화면, `src/lib/` 로직, `public/sw.js` 서비스 워커, `supabase/migrations/` DB, `supabase/functions/` Edge Functions(Deno).

### 기능 → 파일

| 기능 | 파일 |
|---|---|
| 껍데기(탭·☰ 메뉴·PC 왼쪽 메뉴 숨기기) | `Shell.tsx`, `Header.tsx`(TopBar·전체 화면 버튼·PC 제목 줄) |
| 한 일 기록(계획 없이 이미 한 일) | `ActivityEditor.tsx`(입력 창·한 줄·버튼), `lib/planner.ts`(`liveActivities`·`saveActivity`), 표 `activities` |
| 작업·캘린더·타이머·프로필 탭 | `TasksTab.tsx`, `CalendarTab.tsx`, `TimerTab.tsx`/`Study.tsx`, `MeTab.tsx` |
| 말로·적어서 일정 넣기(AI) | `VoiceAdd.tsx`, `WriteAdd.tsx`, `lib/ai.ts`(`saveParsed`), `lib/speech.ts`, Edge `parse-schedule`(`logic.ts`) |
| 표시(생일·기념일·여행) | `MarkEditor.tsx`(MarkEditor·MarkChip), `lib/marks.ts`, 표 `marks` |
| 시간표(학기별 주간 칸·사진으로 넣기, **일정·알림과 따로**) | `TimetableView.tsx`(칸·수업 고치기·학기 기간), `TimetableImport.tsx`(사진/글 → 미리보기), `lib/timetable.ts`, 습관 `in_timetable`·`place`(회차 안 만듦 — `planner.ts` `isClass`·`dropClassOccurrences`), Edge `parse-schedule` mode "timetable", 디자인 값 `docs/design/timetable-ui-guide.md` |
| 커리어 기록 + AI 다듬기 | `Career.tsx`, Edge `career-polish` |
| 알림(앱 안 알람·서버 푸시) | `ReminderEngine.tsx`, `lib/reminders.ts`, `lib/push.ts`, `public/sw.js`, Edge `send-due-notifications`·`notification-action` |
| 폰 잠금화면 일정 카드 | `lib/lockCard.ts`, `LockCardSync.tsx`, `public/sw.js`(lock-card) |
| 테마·배경 | `globals.css`(data-palette), `lib/backgrounds.ts`, `BackgroundPicker.tsx`, `Backdrop.tsx`, `public/themes/bg/` |
| 설정 | `SettingsSheet.tsx`, `lib/settings.ts`(기본값), `lib/types.ts`(Settings 타입) |
| 로그인·가입 신청·승인 대기 | `AuthForm.tsx`, `AccessGate.tsx`, `lib/authLinks.ts`, Edge `signup` |
| 관리자 화면 | `AdminSheet.tsx`, `lib/admin.ts`, Edge `admin` |
| 드라이브(+비밀번호 잠금, Study 폴더) | `DriveSheet.tsx`, `lib/drive.ts`, `lib/vault.ts` |
| 공부 노트(Study 폴더, 오프라인 먼저) | `StudyNotes.tsx`, `lib/studyNotes.ts`, 표 `drive_files.folder`·RPC `must_drive_resize` |
| 사전(영어·국어, 네이버 iframe) | `DictionarySheet.tsx`(타이머 탭·크게 보기 시계에서 엶) |
| PWA 설치·업데이트 | `app/manifest.ts`, `public/sw.js`(VERSION 올리면 설치된 앱이 다음 실행 때 새로 받음) |

## 4. 서버(Supabase) 현재 상태

- **적용된 마이그레이션**: `20261005000000_init` ~ `20261017000000_timetable_no_tasks` 전부.
  `20261008000500_admin_guards` 는 **앞쪽(마지막 관리자 보호 트리거)만 적용**(2026-10-08). 뒤쪽 `must-cleanup` 크론에
  "7일 지난 크론 실행 기록 지우기" 넣는 부분은 DELETE 문 때문에 MCP 승인 창이 60초 안에 안 떠서 미적용 —
  필요하면 대시보드 SQL Editor 에서 그 파일의 `do $do$ … $do$;` 블록만 실행.
- **Edge Functions**(배포 버전): `parse-schedule` v12(글은 Haiku 5.5, 사진·시간표 사진은 Sonnet 5.5) · `career-polish` v4(Sonnet 5.5) · `calendar-feed` v1(**JWT 검증 끔**, 토큰으로 주인) · `admin` v4 ·
  `signup` v3(**JWT 검증 끔**) · `send-due-notifications` v4 · `notification-action` · `push-test` v2(제목 DREAM).
  나머지는 모두 JWT 검증 켬.
- **Vault 비밀값**(Edge `setting()` 이 env → Vault 순으로 읽음): `must_anthropic_key`(Claude API 키, 확인 완료), `must_vapid_public/private/subject`,
  `must_cron_secret`, `must_action_secret`. 키 값은 문서·채팅에 절대 쓰지 말 것.
- **pg_cron**: `must-send-due`(매분 알림 발송), `must-materialize-habits`(매시 5분 습관 회차), `must-cleanup`(매일 04:17).
- **Storage**: 비공개 버킷 `drive`(파일 하나 50MB). 경로 `<user id>/<drive_files.id>`.
- **주요 표·함수**: `must_admins`, `must_members`(승인·이름), `must_app_settings`(signups_open·ai_daily_limit·drive_quota_mb),
  `ai_usage`(+`must_ai_claim` 한도 예약), `drive_files`(+`must_drive_quota`/`must_drive_usage`), `must_admin_*`(관리자 통계, service_role 전용).
- 앱의 공개 키는 `.env.production`(publishable key — 공개돼도 되는 값).

## 5. 작업 방법·도구 요령

- **검사**: `npx tsc --noEmit` · `npx eslint src` · `npm run test:db`(PGlite 로 마이그레이션 실제 실행, 116개) ·
  Edge: `cd supabase/functions && deno test --config deno.json --allow-env --allow-net .`(29개). Deno 가 없으면 `npm i deno` 로 받아 씀.
- **DB 변경**: 새 마이그레이션 파일을 만들고 Supabase MCP `apply_migration`. **`DROP`·`DELETE FROM`·`TRUNCATE` 를 넣으면 MCP 가 승인 창을
  띄우고 멈춘다** — `create or replace`, `add column if not exists`, `for all` 정책 등으로 피한다. 마이그레이션은 "다시 돌려도 안전"하게.
  `supabase/tests/schema.test.mjs` 에 같은 마이그레이션을 넣고 테스트 추가(Auth·Storage 는 흉내 스키마가 있음).
- **Edge 배포**: MCP `deploy_edge_function` — `import_map_path: "deno.json"`, `entrypoint_path: "<함수>/index.ts"`,
  files 에 `deno.json`, `_shared/env.ts`(+필요하면 `_shared/push.ts`·`_shared/ai_usage.ts`), `<함수>/index.ts`·`logic.ts`.
- **샌드박스 네트워크**: 클라우드 세션에서 supabase.co·api.anthropic.com 에 직접 못 붙을 수 있다 → DB 의 **pg_net**
  (`net.http_post` → `net._http_response`)으로 Edge 함수·Claude API 를 시험했다(키는 `vault.decrypted_secrets` 에서 SQL 안에서만 꺼냄).
- **화면 확인**: Playwright(Chromium `/opt/pw-browsers/chromium`). 로그인 화면은 가짜 Supabase 로:
  `NEXT_PUBLIC_SUPABASE_URL=https://mock.supabase.test NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_mock npx next dev -p 3124`
  → `context.route("https://mock.supabase.test/**")` 로 응답을 흉내, 세션은 localStorage `sb-mock-auth-token`.
  dev 오버레이가 클릭을 가로채면 `nextjs-portal{display:none!important}` 스타일을 넣는다. 한글 내려받기 이름은 `LANG=C.UTF-8` 필요.
- **서비스 워커**를 고치면 `public/sw.js` 의 `VERSION`(지금 `must-v8`)을 올린다. 잠금화면 카드 내용은 `must-state` 캐시(버전 바뀌어도 유지).

## 6. AI 모델·비용

- 말로 일정 정리: `claude-haiku-5-5`, thinking 끔, 한 번 약 0.6원. 날짜는 모델이 계산하지 않게 **3주치 달력 표(이번 주/다음 주 표시)** 를 같이 준다.
- 커리어 다듬기: `claude-sonnet-5-5`(effort low), 한 번 약 8원. Haiku 5.5 와 블라인드 비교(5건×3심사)에서 Sonnet 이 '없는 사실 지어내기'가
  적어서(큰 과장 0건 vs 2건) 유지 — 사용자도 Sonnet 을 원함.
- 하루 한도: 한 사람 30회(관리자 무제한, 관리자 화면 → 설정). 비용 어림 단가는 `lib/admin.ts` `PRICE_PER_MTOK`.

## 7. 사용자가 아직 할 일 / 남은 일

- ~~(사용자) Supabase Auth URL Configuration(Site URL·Redirect URLs)~~ — 2026-10-08 사용자가 "다 돼 있다"고 확인.
- (사용자) Auth 설정의 '유출 비밀번호 보호' 켜기(보안 점검 경고 1건).
- (선택) `20261008000500_admin_guards` 의 크론 정리 부분(`do $do$` 블록)을 SQL Editor 에서 실행 — 4절 참고.
- **이어서 할 것(2026-10-08 사용자 요청, 나중에)**: 잠금화면 카드가 사용자 폰(안드로이드·크롬)에서 안 보인다고 함.
  스위치는 켜짐(profiles.settings.lockCard=true), 서버 푸시 등록 기기는 0대. 설정 → 알림의 '지금 띄워 보기'(`testLockCard`)가 알려 주는
  문구부터 확인하고, 잠금화면에 '무엇을' 보여 줄지도 사용자와 다시 정하기로 함(지금은 소리 없는 알림 한 장).
- 아이디어(요청 오면): 드라이브 잠긴 파일의 **이름도 숨기기**, 커리어 프롬프트에 "동사 부풀리기 금지(체크→관리, 왔다→유치)·응시 전 자격은 기술에 넣지 말 것" 추가,
  아이폰 잠금화면 카드(웹앱 한계로 현재 안드로이드만).

## 8. 최근에 한 일(이 순서로 배포됨)

1. 일정 정리 AI → Haiku 5.5(10배 싸게) + "금요일까지" 날짜 오류 수정
2. 폰 잠금화면 일정 카드(안드로이드, 설정 → 알림) — **2026-10-08 부터 기본 꺼짐(원하는 사람만 켬)**, 켤 때 알림 권한을 바로 물음.
   아이폰은 웹앱이 알림을 조용히 고쳐 달 수 없어 불가(설정 화면에 안내).
3. 가입 관리자 승인제(신청 → 관리자 폰 알림 → 승인/거절, 승인 전엔 '승인 대기' 화면·AI 0회)
4. PC 전체 화면 버튼 오른쪽 위 구석
5. 드라이브(☰ 메뉴 → 드라이브, 1인 150MB·파일 50MB) + 파일 비밀번호 잠금(브라우저에서 AES-GCM 암호화, 운영자도 못 봄)
6. 가입 신청 때 이름 필수 → 관리자 화면·알림에 이름 표시
7. 테마 추가(라임 외 **바다·벚꽃·라벤더**, 각각 밝게/어둡게) + 사진 배경에 **내 사진** 넣기
8. **한 일 기록** — 일정(계획)과 따로 이미 한 일만 남김. 알림·강제 모드·사유서·'놓침' 없음(표 `activities` 가 일정과 아예 따로라
   서버 알림 트리거도 안 걸림). 시각은 넣어도 되고 안 넣어도 됨. 모양: 청록(`--did` 토큰)·체크·점선 테두리.
   어디서: 폰 ＋ 버튼 위 '한 일', PC 왼쪽 메뉴 '한 일 기록', 캘린더 날짜 칸(목록), 주/일 타임라인(점선 줄무늬 블록, 끌기 안 됨),
   달력 칸 '✓n', 프로필 → 요약 '이번 주 한 일', 커리어 AI 재료에도 포함.
9. **못 한 일정 다시 잡기** — 놓침·건너뜀 일정은 그날 하루 '오늘 못 한 일'에 남고, 누르면(목록·타임라인·편집 창) '언제 다시 할까요?'
   (`RescheduleDialog`, `rescheduleTask`) → 새 시각으로 옮겨지고 그날 목록에서 빠짐. 사유는 다시 묻지 않음(이미 기록됨, 로그는 `reopened`).
   같은 창에서 지우기(두 번 눌러 확인).
10. **확인용 알림 팝업(토스트) 제거** — 완료·추가·저장·삭제·되돌리기·시작·미룸 같은 '했어요' 팝업은 사용자가 "AI 티 난다"고 해서 뺌.
    남긴 것: 오류(빨강), 앱 안 알림(ReminderEngine), 설정·로그인·관리자 화면의 결과 안내. 삭제는 되돌리기 대신 '두 번 눌러 확인'.
    **새 기능에 '했어요' 팝업을 다시 넣지 말 것.**
11. **배경만 보기** — 사진 배경 테마일 때 위쪽 막대의 그림 아이콘·배경 고르는 칸 아래 '배경만 보기' → 글자·버튼 없이 사진만
    (어둡게 하지 않음, PC 는 전체 화면). 아무 곳이나 누르거나 Esc 로 닫힘. `Backdrop.tsx` 의 `WallpaperView`.
12. **Write(적어서 일정 넣기)** — Voice 옆 'Write'(PC 왼쪽 메뉴·위쪽 막대, 폰 위쪽 연필 아이콘). "29일 1시부터 2시 치과"처럼 적으면
    parse-schedule(v6)로 정리해 **확인 없이 바로** 일정에 넣고, 창 안 '넣은 일정'에서 고치기·빼기. 지난 시각은 바로 넣지 않고 '그래도 넣기'
    (강제 모드 끔). `WriteAdd.tsx`, `lib/ai.ts`(`saveParsed` 가 만든 일정·습관을 돌려줌, `isPastItem`).
    parse-schedule v6: 달력 표 6주(42일)로 늘림 + "29일"·"다음 달 3일"·이름 없는 입력("일정") 규칙 — 실제 모델로 5문장 시험 통과.
13. 위쪽 막대 글자 영어(Live sync·Voice·Write 등). 폰에서 PC 전용 '전체 화면' 버튼이 맨 오른쪽 아이콘을 덮던 버그 수정
    (`hidden` 이 `inline-flex` 에 CSS 순서로 져서 생김 → `max-md:hidden` 으로).

14. **일기(DREAM)** — 서버·운영자도 못 읽는 암호화 일기(로그인 비밀번호로 만든 열쇠가 자동으로 열림, 일기 비밀번호 없음), 자동 저장,
   ☰ 기록 첫 줄 무지개색 DREAM. 명세 `docs/diary/SPEC.md`·`UI-API.md`, 코어 `src/lib/diary*.ts`, 화면 `DiarySheet.tsx`, 표 `diary_entries`·`diary_keys`.
15. **일기 책 여닫기 애니메이션** — 엔진 `src/lib/diaryIntro/`(프레임워크 없음), `DiaryIntro.tsx` 가 dynamic import. 효과음은 설정에서만(기본 꺼짐).
   2026-10-10 다듬기(닫기 = 끝까지 넘겨 뒷표지 DIARY, 버벅임 줄임) — 0-0 참고.
16. **타이머 사전 + 공부 노트** — `DictionarySheet.tsx`(네이버 사전 iframe, 영어·국어), `src/lib/studyNotes.ts`·`StudyNotes.tsx`
   ('드라이브'는 DREAM 서버 보관함 Study 폴더, 구글 드라이브 아님), 마이그레이션 `20261012000000_drive_folder`·`20261012000100_drive_rewrite`.
17. **끝난 일정은 '했나요?'** — `planner.ts` `taskState: unchecked`·`checkinQueue`·`confirmDone`, `Enforcement.tsx` `CheckinModal`.

18. **돌아보기 통계**(2026-10-10) — ☰ '돌아보기·변명 노트'(LogSheet)에 주/달 보기, 계획 대비 실제, 카테고리별 시간(계획·해냄·한 일),
   습관별 지킨 횟수, 아침/오후/저녁/밤 지킨 비율·어긴 횟수(미룸은 원래 시각으로), 약한 시간대·요일 안내. 계산 `src/lib/review.ts`, 시험 `tests/review.test.mjs`.

19. **카톡 공유로 일정 넣기**(2026-10-10) — manifest `share_target`(GET ?title&text&url → `/`), `ReminderEngine` 이 `src/lib/share.ts` 로 정리해
   sessionStorage(`must:shared-text`) → Write 창에 채워 엶(넣기는 사용자가 누름). 안드로이드 설치 앱만(아이폰 미지원 → 복사해서 Write).

20. **사진으로 일정 넣기**(2026-10-10) — Write 창 사진 버튼 → `src/lib/photo.ts`(긴 변 1568px JPEG) → `parseSchedule(..., image)` →
   Edge `parse-schedule` **v7**(image 받기 `checkImage`, Haiku 5.5 에 사진+날짜 표). 시간표는 매주 반복으로. 실제 사진 호출은 로그인 계정으로만 확인 가능(아직 안 해 봄).

21. **PC 인박스 → 끌어서 시간표에**(2026-10-10) — 캘린더 탭 주/일 시간표 오른쪽 `Inbox.tsx`(PC만, `max-md:hidden`): 날짜 없음 + 오늘 이후 날짜만 할 일,
   바로 적기. 끌어 놓으면 `Timeline` `onDropTask` → `placeTask`(시각 일정 1시간, 알림 기본값, 지난 시각이면 강제 끔). 끄는 동안 점선 칸 표시.

22. **끝난 일정엔 '시작 안 함' 폰 알림 안 보냄**(2026-10-10) — `send-due-notifications` v4 `rules.ts` `skipEndedOverdue`·`badgeCounts`,
   아침 브리핑은 '했는지 확인할 일정 N건'. 앱 안 알림도 끝난 일정은 건너뜀.

23. **AI 로 일정 지우기·옮기기**(2026-10-10) — "내일 치과 취소해줘"·"회의 4시로 옮겨줘"·"운동 그만할래". 지우기·옮기기 말(`REMOVE_RE`)이 있을 때만
   기존 일정 목록(`existingForAi`: 2일 전~60일 뒤 + 날짜 없음 최대 220개, 반복 30개, ref t#/h#)을 보냄 → parse-schedule **v8** 이 `remove`(ref 목록) 돌려줌.
   미리보기 '지울 일정'(체크해서 고름)에서 확인한 뒤 지움 — `AiRemovals.tsx`(`toRemovalDrafts`·`RemovalList`·`applyRemovals`). 반복은 앞으로 회차도 지움.
   미시작 경고 중인 강제 일정은 잠금(못 지움). 실제 모델 5문장(지우기·옮기기·습관 그만·하루만·다 지워) 통과, 한 번 약 0.4원.

24. **기간 있는 반복**(2026-10-10, 사용자: "이번 달 매일 넣었더니 16일까지만") — 원인: 습관 회차를 7일 앞까지만 만들고 끝나는 날이 없었음.
   `habits.start_day`·`end_day`(마이그레이션 `20261013000000_habit_range`, 서버 `materialize_habits` 도 기간 지킴), AI `repeat_until`(끝나는 날),
   앱은 끝나는 날이 있는 반복은 그날까지(최대 62일) 미리 만듦(`habitHorizon`). 반복 편집 창에 '기간'(선택). 습관을 만든 시각보다 이른 오늘 회차는 안 만듦(앱·서버 같음).

25. **☰ 드라이브에도 '새 노트'**(2026-10-10) — 파일이 0개여도 📒 Study 칸이 보이고, '파일 올리기' 옆 '새 노트'(Study 폴더에 만듦).

26. **커리어 '한 번에 넣기'**(2026-10-10) — 커리어 기록 → '한 번에 넣기' → 붙여 넣기 → Edge `career-polish` **v4** mode "import"(Sonnet 5.5 effort low,
   구조화 출력)가 항목별로 나눔(글은 그대로, 날짜·종류·기술만) → 미리보기(체크·이미 있음·날짜 확인·'넣지 않은 줄'·칸마다 고치기) → 고른 것만 저장.
   화면 `CareerImport.tsx`, 공용 `src/lib/career.ts`, 서버 `career-polish/import.ts`(`cleanImported` 가 부분 날짜 → 첫날·말일).
   모델 시험: Haiku 는 항목 빠뜨림 → Sonnet(2,459자 22항목 완전, 약 13초·43원). 시험용 임시 Edge `career-import-eval` 은 v2 로 닫음(항상 410, JWT 필요).
   이전 계정이 돌린 검토 2명 결과는 기록이 없어 다음 계정이 코드를 직접 점검함(큰 문제 없음, 기다림 안내만 '1분쯤'으로).

27. **구글 캘린더에서 보기**(2026-10-10) — 사용자: "일단 구글 캘린더까지만". 표 `calendar_feeds`(마이그레이션 `20261014000000`, RLS 본인만) +
   Edge `calendar-feed` v1(verify_jwt **끔**, `?token=` 으로 주인, 지난 30일~180일 ICS, 날짜만 = 종일·끝낸 건 ✓, `calendar-feed/logic.ts` + Deno 시험) +
   설정 '구글 캘린더에서 보기'(`src/lib/calendarFeed.ts`: 만들기·복사·구글 URL로 추가 바로가기·새 주소·끄기). pg_net 으로 200·일정 33개 확인.
   같이: 카톡 등 앱 안 브라우저 안내 `InAppNotice` 를 모든 탭 맨 위로(작업 탭 카드에선 뺌).

28. **공부 타이머 계속 재기**(2026-10-10) — 사용자: 열품타처럼 잡지 말고 나가 있어도 계속. '자리 비우면 멈춤' 기본 꺼짐, 설정 키를 `studyAwayStop` 으로 바꿔
   예전 `studyAutoPause`(켜짐) 저장값은 버림. 시간은 원래 시작 시각 기준이라 앱을 꺼도 계속 감.
29. **표시(생일·기념일·시험·여행)**(2026-10-11) — 표 `marks`(마이그레이션 `20261015000000`), `src/lib/marks.ts`(매년 반복·여러 날·다가오는 표시),
   `MarkEditor.tsx`. 캘린더 칸·날짜 칸·작업 탭 '다가오는 표시'·메뉴 '표시 남기기'. 할 일·한 일과 달리 체크·알림 없음.
   다음에 할 만한 것: 주·일 시간표 머리에도 표시.
30. **Write·말로 추가 → 표시**(2026-10-11, 사용자: "Write에서도 표시로") — parse-schedule **v9→v10**: kind `mark` + `end_date`(여러 날)·`yearly`(매년)·`emoji`.
   생일·기념일·여행·시각 없는 시험·D-day 는 표시, 그날 할 일("생일 선물 사기")·시각이 있으면 일정. `clean()` 이 표시는 시각·반복·알림·카테고리 비움.
   앱: `saveParsed` 가 표시는 `saveMark`(분홍), Write '넣은 일정'에 🎂 표시 · 날짜 · 매년, '고치기' → MarkEditor. 말로 추가 미리보기에 '표시' 칸·매년·끝나는 날.
   확인: Deno 시험 12개, 가짜 로그인 + 가짜 AI 답으로 Playwright(표시 2·일정 1 저장), 실제 Haiku 5.5(pg_net) 한 문장에 7개 —
   표시 5(내 생일·엄마 생신·결혼기념일 매년, 제주 여행 20~23일, 토익 다음 주 수) + 일정 2(선물 사기 금, 치과 토 15:00) 모두 맞음, 약 1원.
   검토(2명 + 찾은 것마다 반박 1명, 워크플로) 뒤 고친 것(v10):
   ① **없는 날짜**("2026-11-31"·"2027-02-29")가 꼴만 맞아 그대로 저장 → DB date 칸이 거절해 그 표의 올리기 묶음이 5번 실패 후 버려짐.
      서버 `realDate`(말일로 당김)·매년 2/29 는 앞 윤년(2024-02-29, 평년엔 앱이 28일에 보임) + 앱 `fixDayKey`(time.ts)로 표시·반복 끝날·시작일 한 번 더.
   ② AI 가 표시를 못 봐서 "제주 여행 25일로 바꿔줘"가 표시를 하나 더 만듦 → `existingForAi` 에 표시(m1…, 매년 것 + 그제 이후, 최대 50)
      + `checkExisting` 이 m ref 받음 + `applyRemovals` 가 `deleteMark`. 실제 모델: 옮기기(m2 지우고 25~28일 새로)·지우기·2/29 모두 맞음.

31. **시간표 보기 + 시간표 사진으로 넣기**(2026-10-12, 사용자: 에브리타임 조사 → "1번이랑 2번", "에타 없는 사람도 다른 캡처로") —
   습관에 `in_timetable`·`place`(마이그레이션 `20261016000000_timetable`, null 허용). 캘린더 탭 '시간표': 학기(= 수업들의 start_day~end_day)별 주간 칸,
   토·일은 수업 있을 때만, 지금 시각 줄, 칸 누르면 수업 고치기(밤새 하는 일은 '다음 날'까지), '학기 기간'으로 학기 수업 전부 기간 바꾸기,
   기간 없는 알바·동아리('시간표에 보이기' 켠 습관)는 겹치는 모든 학기에 같이 보임. '사진으로 넣기': 에타·학교 포털·종이·학원 시간표 사진 또는 글 →
   parse-schedule **v11** `mode: "timetable"`(**Sonnet 5.5 effort low** — 가짜 에타 캡처에서 Haiku 는 끝 시각 16개 중 7개 틀림, Sonnet 다 맞음;
   `block` 칸(키가 이름 순으로 나오는 걸 이용해 "6-7교시"를 먼저 적게 함); 교시만 있으면 1교시 9시·50분으로 짐작) → 미리보기(이미 있는 수업은 빼 둠)
   → 학기 동안 매주 반복(강제 모드 끔, 과목마다 색). 시험 이미지 `parse-schedule/testdata/*.jpg`(가짜), pg_net 에서 raw.githubusercontent URL 로 호출.
   포털(교시+시각) 사진 하나는 6-7교시를 6교시로 읽음 — 미리보기에서 고치게 함.
   검토(2명 + 반박 1명씩)로 고친 것: `updateHabit` 이 ① 기간·요일을 줄였다 되돌리거나 멈췄다 다시 시작하면 지워졌던 회차를 되살림(예전엔 영영 안 생김),
   ② 시각·길이가 바뀔 때만, 옮기거나 미룬 회차는 빼고 시각을 고침(학기 기간만 바꿔도 보강 시각이 돌아가던 문제; 서버 회차의 +00:00 꼴은 숫자로 비교),
   ③ 밤새 하는 수업(22:00~02:00) 저장·표시 ④ 사진 읽는 동안 학기 기간을 바꿔도 읽기 누른 때 기간으로 저장 ⑤ 기간 없는 항목이 따로 '학기'가 되던 것.
   시험: 단위 100(`tests/timetable.test.mjs`·`tests/habit-update.test.mjs`), DB, Deno 56, Playwright 가짜 로그인 390·1280.

32. **사진으로 일정 넣기 찾기 쉽게**(2026-10-12, 사용자: "카톡 캡처 어떻게 넣냐, 위치를 모르겠다", "복사 붙여넣기가 안 돼 아쉽다") —
   폰 '📷 사진' 버튼(한 일 위)·PC 왼쪽 '사진으로 일정 넣기' → 고르면 줄여서 Write 에 넣은 채로(`src/lib/pending.ts` 로 넘김).
   복사한 사진 붙여넣기: Write·시간표 사진 창이 떠 있는 동안 Ctrl+V(`usePasteImage`), '복사한 사진 붙여넣기' 버튼(`navigator.clipboard.read`) — `src/lib/clipboard.ts`.
   '공유 → DREAM' 이 사진도 받음: manifest share_target 을 POST multipart(`/share-target`, files image/*)로 →
   `public/sw.js`(must-v9)가 받아 캐시 `must-share` 에 두고 `?shared=1` 로 → ReminderEngine 이 `takeSharedFromWorker` 로 꺼내 Write 에 글·사진.
   예전 GET(?text=)도 그대로 받음. Write 사진에서 '시간표에 넣기' → 캘린더 시간표 + 사진으로 넣기 창(그 사진 그대로), ☰ 메뉴 '시간표'
   (`OPEN_TIMETABLE` 이벤트 + `pendingTimetable`). 위쪽 '배경만 보기' 아이콘은 사진 넣기로 헷갈려 눈 모양으로.
   Playwright: 사진 버튼 → Write, Write → 시간표, ☰ 시간표, 붙여넣기 이벤트, 서비스 워커 공유(POST → ?shared=1 → 사진·글) 다 확인.

33. **시간표는 시간표만 + 칸 디자인 다듬기 + 카톡 캡처 정확도**(2026-10-12) —
   사용자: "시간표는 시간표야, 캘린더 일정에 넣으면 더러워져 — 수강계획을 일정으로 넣지 마". → 수업(`in_timetable` 습관)은 **회차(일정)·알림·'했나요?'를
   만들지 않음**: 앱 `materializeHabits` 가 수업을 건너뛰고 `dropClassOccurrences` 로 예전 수업 회차를 지운 표시, `updateHabit` 의 habitOn 도 수업은 false,
   서버 `materialize_habits` 도 건너뜀 + 이미 있던 수업 회차 88개 지운 표시(마이그레이션 `20261017000000_timetable_no_tasks`, UPDATE 만).
   ☰ 습관 목록·습관 패널·AI 지우기 목록에서 수업 뺌(`routineHabits`), 습관 편집의 '시간표에 보이기' 스위치 없앰(시간표는 캘린더 → 시간표에서만).
   Write 에 시간표 사진을 넣으면 일정 대신 "시간표 사진 같아요 — '시간표에 넣기'"로 안내(프롬프트).
   칸 디자인(사용자가 붙인 5가지 지적 — `docs/design/timetable-ui-guide.md`): 모서리 10px 하나, 시각 숫자를 선 높이에 + 지금 시각 배지(선 위치는 원래 맞았음),
   칸 여백 폰 6/4px·PC 10/8px, 색은 테마 바탕에 30% 섞은 칸 + 왼쪽 색 띠(글자는 테마 글자색), 수업 없는 평일은 좁게 + '공강', 낱말 단위 줄바꿈.
   붙여넣기 검토 반영: 글도 같이 있으면(엑셀 셀 등) 글 붙여넣기를 그대로, 받을 때만 막음, 위에 뜬 다른 창 입력칸은 안 건드림. Write 가 사진을 읽는 중엔 '시간표에 넣기' 숨김.
   **parse-schedule v12**: 사진(카톡 캡처 등)도 **Sonnet 5.5 effort low**(가짜 카톡 캡처에서 Haiku 는 "다음 주 수요일까지"를 이번 주로, Sonnet 맞음), 글은 Haiku 그대로.
   카톡 규칙: 마지막에 정한 시각, 짧은 대답은 앞 메시지 전체 뜻으로, 대화 날짜줄 기준, '~까지'는 날짜 일정(언젠가 아님). 시험 이미지 `testdata/kakao-sample.jpg`(가짜).

## 9. 테마·배경 구조

- 테마 목록 `src/lib/palettes.ts`, 고르는 칸 `PalettePicker.tsx`(☰ 메뉴·설정 → 화면·데이터), 색 `globals.css`:
  단색 테마는 `html[data-palette=X]:not([data-theme="dark"])`(밝게) / `html[data-palette=X][data-theme="dark"]`(어둡게) 로
  포인트색·바탕 색조만 덮는다(라임 = 기본 :root 값). 새 테마는 이 두 블록 + `palettes.ts` 한 줄 + `types.ts` 의 palette 타입에 추가.
- 사진 배경(`dusk`)의 '내 사진': `src/lib/customBg.ts` — 긴 쪽 2560px webp 로 줄여 **이 기기 IndexedDB 에만** 저장
  (`settings.background = "custom"`). 다른 기기에서는 기본 그림으로 보이고 거기서 따로 넣으면 된다. `Backdrop.tsx`·`BackgroundPicker.tsx`.
- 알람 화면(`AlarmOverlay.tsx`)은 테마와 상관없이 일부러 라임/빨강 고정.

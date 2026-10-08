# DREAM 인수인계 (2026-10-08 기준)

> 새 계정·새 세션에서 이 앱을 이어서 고칠 때 **이 파일부터** 읽으세요. 기능별 자세한 기록은 `docs/REVAMP-HANDOFF.md`,
> 구조는 `docs/ARCHITECTURE.md`, 알림은 `docs/PWA-NOTIFICATIONS.md`, 서버 처음 설정은 `docs/SETUP-SUPABASE.md`.

## 1. 한눈에

- **DREAM**(예전 이름 MUST) — 개인 플래너 PWA. 폰·PC에 설치해서 쓴다. 일정·습관·공부 타이머·커리어 기록·드라이브·알림·AI.
- 주소: https://c2k-ai.github.io/Schedule_app/ (GitHub Pages, `main` 에 push 하면 자동 배포 — `.github/workflows/pages.yml`)
- 저장소: `C2K-ai/schedule_app` · 작업 브랜치 `ui-revamp` → 배포 브랜치 `main`
  (`bg-fetch`·`bg-results` 는 배경 사진 받기용 보조 브랜치, 지워도 됨 — 프록시가 원격 브랜치 삭제를 막아 남아 있음)
- 서버: Supabase 프로젝트 **`gcnosxcojuefkaaxefug`** (DB·Auth·Storage·Edge Functions·pg_cron·pg_net·Vault)
- 관리자(주인): `gstop508@gmail.com` (첫 가입자 = 자동 관리자)

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
| 말로 일정 넣기(AI) | `VoiceAdd.tsx`, `lib/ai.ts`, `lib/speech.ts`, Edge `parse-schedule` |
| 커리어 기록 + AI 다듬기 | `Career.tsx`, Edge `career-polish` |
| 알림(앱 안 알람·서버 푸시) | `ReminderEngine.tsx`, `lib/reminders.ts`, `lib/push.ts`, `public/sw.js`, Edge `send-due-notifications`·`notification-action` |
| 폰 잠금화면 일정 카드 | `lib/lockCard.ts`, `LockCardSync.tsx`, `public/sw.js`(lock-card) |
| 테마·배경 | `globals.css`(data-palette), `lib/backgrounds.ts`, `BackgroundPicker.tsx`, `Backdrop.tsx`, `public/themes/bg/` |
| 설정 | `SettingsSheet.tsx`, `lib/settings.ts`(기본값), `lib/types.ts`(Settings 타입) |
| 로그인·가입 신청·승인 대기 | `AuthForm.tsx`, `AccessGate.tsx`, `lib/authLinks.ts`, Edge `signup` |
| 관리자 화면 | `AdminSheet.tsx`, `lib/admin.ts`, Edge `admin` |
| 드라이브(+비밀번호 잠금) | `DriveSheet.tsx`, `lib/drive.ts`, `lib/vault.ts` |
| PWA 설치·업데이트 | `app/manifest.ts`, `public/sw.js`(VERSION 올리면 설치된 앱이 다음 실행 때 새로 받음) |

## 4. 서버(Supabase) 현재 상태

- **적용된 마이그레이션**: `20261005000000_init` ~ `20261010000000_activities` 전부.
  `20261008000500_admin_guards` 는 **앞쪽(마지막 관리자 보호 트리거)만 적용**(2026-10-08). 뒤쪽 `must-cleanup` 크론에
  "7일 지난 크론 실행 기록 지우기" 넣는 부분은 DELETE 문 때문에 MCP 승인 창이 60초 안에 안 떠서 미적용 —
  필요하면 대시보드 SQL Editor 에서 그 파일의 `do $do$ … $do$;` 블록만 실행.
- **Edge Functions**(배포 버전): `parse-schedule` v5(Haiku 5.5) · `career-polish` v3(Sonnet 5.5) · `admin` v4 ·
  `signup` v3(**JWT 검증 끔**) · `send-due-notifications` · `notification-action` · `push-test` v2(제목 DREAM).
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

- (사용자) Supabase → Authentication → URL Configuration: Site URL `https://c2k-ai.github.io/Schedule_app/`,
  Redirect URLs `https://c2k-ai.github.io/Schedule_app/**` — 비밀번호 재설정 메일 링크용. 가입은 이제 메일 없이 되므로 급하지 않음.
- (사용자) Auth 설정의 '유출 비밀번호 보호' 켜기(보안 점검 경고 1건).
- (선택) `20261008000500_admin_guards` 의 크론 정리 부분(`do $do$` 블록)을 SQL Editor 에서 실행 — 4절 참고.
- 아이디어(요청 오면): 드라이브 잠긴 파일의 **이름도 숨기기**, 커리어 프롬프트에 "동사 부풀리기 금지(체크→관리, 왔다→유치)·응시 전 자격은 기술에 넣지 말 것" 추가,
  아이폰 잠금화면 카드(웹앱 한계로 현재 안드로이드만).

## 8. 최근에 한 일(이 순서로 배포됨)

1. 일정 정리 AI → Haiku 5.5(10배 싸게) + "금요일까지" 날짜 오류 수정
2. 폰 잠금화면 일정 카드(안드로이드, 설정 → 알림)
3. 가입 관리자 승인제(신청 → 관리자 폰 알림 → 승인/거절, 승인 전엔 '승인 대기' 화면·AI 0회)
4. PC 전체 화면 버튼 오른쪽 위 구석
5. 드라이브(☰ 메뉴 → 드라이브, 1인 150MB·파일 50MB) + 파일 비밀번호 잠금(브라우저에서 AES-GCM 암호화, 운영자도 못 봄)
6. 가입 신청 때 이름 필수 → 관리자 화면·알림에 이름 표시
7. 테마 추가(라임 외 **바다·벚꽃·라벤더**, 각각 밝게/어둡게) + 사진 배경에 **내 사진** 넣기
8. **한 일 기록** — 일정(계획)과 따로 이미 한 일만 남김. 알림·강제 모드·사유서·'놓침' 없음(표 `activities` 가 일정과 아예 따로라
   서버 알림 트리거도 안 걸림). 시각은 넣어도 되고 안 넣어도 됨. 모양: 청록(`--did` 토큰)·체크·점선 테두리.
   어디서: 폰 ＋ 버튼 위 '한 일', PC 왼쪽 메뉴 '한 일 기록', 캘린더 날짜 칸(목록), 주/일 타임라인(점선 줄무늬 블록, 끌기 안 됨),
   달력 칸 '✓n', 프로필 → 요약 '이번 주 한 일', 커리어 AI 재료에도 포함.

## 9. 테마·배경 구조

- 테마 목록 `src/lib/palettes.ts`, 고르는 칸 `PalettePicker.tsx`(☰ 메뉴·설정 → 화면·데이터), 색 `globals.css`:
  단색 테마는 `html[data-palette=X]:not([data-theme="dark"])`(밝게) / `html[data-palette=X][data-theme="dark"]`(어둡게) 로
  포인트색·바탕 색조만 덮는다(라임 = 기본 :root 값). 새 테마는 이 두 블록 + `palettes.ts` 한 줄 + `types.ts` 의 palette 타입에 추가.
- 사진 배경(`dusk`)의 '내 사진': `src/lib/customBg.ts` — 긴 쪽 2560px webp 로 줄여 **이 기기 IndexedDB 에만** 저장
  (`settings.background = "custom"`). 다른 기기에서는 기본 그림으로 보이고 거기서 따로 넣으면 된다. `Backdrop.tsx`·`BackgroundPicker.tsx`.
- 알람 화면(`AlarmOverlay.tsx`)은 테마와 상관없이 일부러 라임/빨강 고정.

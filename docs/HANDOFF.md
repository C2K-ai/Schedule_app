# DREAM 인수인계 (2026-10-08 기준)

> 새 계정·새 세션에서 이 앱을 이어서 고칠 때 **이 파일부터** 읽으세요. 기능별 자세한 기록은 `docs/REVAMP-HANDOFF.md`,
> 구조는 `docs/ARCHITECTURE.md`, 알림은 `docs/PWA-NOTIFICATIONS.md`, 서버 처음 설정은 `docs/SETUP-SUPABASE.md`.

## 0. ⚠️ 지금 상태 — 2026-10-09 갱신 (여기부터 읽기)

**브랜치**: 2026-10-09 **일기 여닫기 책 애니메이션을 앱에 붙여 main 에 배포함**(f782fda). 그 뒤 `ui-revamp` 는 이 문서만 더 고침.

### 0-0. 🔧 지금 하는 일 — 애니메이션 심사·다듬기 (2026-10-09 낮 시작)
사용자가 배포판을 폰에서 써 보고 말한 아쉬운 점(이게 1순위):
1. **닫기(X) 애니메이션이 너무 짧게 느껴짐** — 지금 CLOSE 1.46초, 끝나면 앱으로 바로 툭 돌아감.
2. **"버퍼링 같은 게 심함"** — 시작 전 멈칫(엔진 청크 받기·만들기)인지, 중간 프레임 끊김(캔버스·블렌드·3D 노드 900개)인지 재는 중.

진행 방식: 사용자가 "심사랑 다듬기 시작"을 허락함(ultracode). 순서 = ① 진단 워크플로(5명: 시작 지연·프레임 비용·닫기 연출·디자인 심사·코드 검토
→ 회의적 검증 → 고칠 계획) → ② 계획대로 고치기 → ③ 다시 재고 심사 → ④ 배포(ui-revamp → main).
- ① 진단: **진행 중**. 결과·계획이 나오면 여기에 적는다.
- 측정용 배포판: `next build` 결과 `out/` 를 스크래치 `srv/Schedule_app`(심볼릭 링크)로 `python3 -m http.server 3200` →
  http://localhost:3200/Schedule_app/ (새 세션이면 다시 띄워야 함). 측정 스크립트·사진은 스크래치 `diag/<담당>/` 아래.
- 참고: 디자인 심사 예전 목록 `docs/design/diary-intro/POLISH-REVIEW.md`(프로토타입 기준 — 엔진에도 남았는지 확인 중).

### 0-1. 일기 (☰ 기록 → 무지개색 "DREAM") — 배포됨
사용자 요구(확정):
- '하루 노트'(캘린더, 낙서용)는 **그대로 둔다**. 일기는 완전히 따로.
- **서버·운영자(그리고 Claude)도 못 읽게** — 기기 안에서 암호화해서 올린다. **일기 전용 비밀번호는 없음**: 로그인 비밀번호로 만든 열쇠가
  로그인할 때 자동으로 열린다(이미 로그인돼 있던 기기·메일 코드 로그인 기기는 로그인 비밀번호를 한 번만 넣음).
- 메뉴 이름은 **"DREAM"**, 글자는 **무지개색**(사용자가 제일 마음에 들어 하는 부분).
- 쓰는 대로 자동 저장(0.7초), 서버엔 최대 5초마다·닫을 때 바로. 두 기기 충돌은 둘 다 남김.
- 새 가입 비밀번호 **8자 이상**(기존 6자 사용자는 로그인 그대로). 짧은 비밀번호면 일기 화면에서 살짝 권유.

설계·명세: **`docs/diary/SPEC.md`**(3명 검토 → 합친 최종 명세, 반영·기각한 지적 목록 포함), UI 가 쓰는 엔진 API: **`docs/diary/UI-API.md`**.
- 코어(완료·검토 중): `src/lib/diaryCrypto.ts`·`diaryStorage.ts`(IndexedDB, 기기 안에서도 잠긴 채 저장)·`diaryRemote.ts`·`diaryKeys.ts`(열쇠 수명주기)·
  `diary.ts`(DiaryEngine), `store.ts` 연결(`snap.diary`, `store.diary`). 일기는 `TABLES`/백업 파일에 **안 들어감**.
  시험: `npm run test:unit`(31개, node 22 타입 스트리핑 — `tests/`), `npm run test:db`(157개, 일기 36개 포함). 넘길 때 전부 통과 상태였음.
- 마이그레이션 `20261011000000_diary.sql` — **서버에 적용 완료(2026-10-08 저녁)**. 서버에서 직접 확인: 판(ver) 올라감·옛 판 저장은 버려짐·
  평문은 CHECK 로 거부·anon 은 못 읽음.
- UI(**완성**, 브라우저로 확인함): `src/components/DiarySheet.tsx`(전체 화면 '종이 일기장'),
  `DiaryIntro.tsx`(책 애니메이션, 0-2),
  Shell(기록 첫 줄 DREAM), PlannerProvider(4번째 인자 diaryMode), AuthForm(`diaryAfterLogin`), SettingsSheet(비밀번호 바꾸기 → `store.diary.changePassword`,
  로그아웃 '이 기기에서 일기도 지우기', 효과음 스위치), AdminSheet 안내문, `supabase/functions/signup/logic.ts`(8자).
  → 2026-10-08 저녁 확인: tsc·eslint·test:unit 49·test:db 157·next build 모두 통과. 브라우저(Playwright) 확인:
  로컬 모드(이 기기 열쇠) 폰·PC 쓰기→'저장됨'→새로 고침 뒤 남음→닫기 OK. 로그인 모드는 **가짜 Supabase 뒤에 PGlite+진짜 마이그레이션**을
  붙여서(스크립트 예: 스크래치의 `diary-cloud.mjs`, `node --import tests/register.mjs` 로 실행, `tests/pgliteRemote.mjs` 의 `bootDb().remote(uid)` 에
  PostgREST 요청을 연결) 확인: 기기 A 로그인→쓰기→서버엔 암호문만 / 기기 B 같은 비밀번호 로그인→저절로 열림 / 이미 로그인된 기기 C→
  로그인 비밀번호 한 번(틀리면 '비밀번호가 틀렸어요')→열림.
- signup Edge 함수 **v4 배포 완료**(8자).
- **배포됨**. 여닫기 애니메이션은 0-2.

### 0-2. 일기 열고 닫는 애니메이션 — **앱에 붙여 배포함(2026-10-09)**
- 펼치기: 덮여 눕혀진 하드커버(표지 **DREAM 2026**, 홀로그램 박) → 표지가 왼쪽 책등 축으로 열림 → 촤라락 + 금빛 빛줄기·반짝이
  → 오른쪽 종이가 앞으로 나와 일기장(약 2.5초). 덮기: 종이가 작아짐 → 반대 방향(왼→오)으로 덮임 → 뒤집혀 **뒷표지 "DIARY"**(약 1.5초).
  누르면 건너뜀, '움직임 줄이기'면 0.32초 페이드.
- 엔진: `src/lib/diaryIntro/`(`math`·`timeline`·`art`·`css`·`sound`·`engine`), `createDiaryIntro(root, {mode, reducedMotion, sound, date, onDone})`.
  `DiaryIntro.tsx` 가 dynamic import 로 붙임 — 못 불러오면 예전 0.35초 페이드로.
- **효과음은 기본 꺼짐**, 설정의 '일기 열고 닫을 때 효과음'에서만 켬(`DIARY_INTRO_SOUND = true` 라 스위치 보임). 일기 화면의 스피커 버튼은 뺌.
- 확인: Playwright 로 폰·PC 각각 열기→일기 화면, 닫기→뒷표지 DIARY→앱 복귀, 런타임 오류 없음. tsc·eslint 깨끗.
- 아직 안 한 것(사용자가 원하면): `docs/design/diary-intro/POLISH-REVIEW.md` 의 다듬을 점(표지가 옆으로 설 때 얇아지는 순간, PC 위쪽 잘림 등).
  디자인 시안·심사 기록은 `docs/design/diary-intro/` 에 그대로 있음.

### 0-3. 사용자에게 준 링크(gstop508@gmail.com 계정 소유 Artifact)
- 애니메이션 미리보기: https://claude.ai/artifact/3MLTmoRmJuWrRpVNphXwhf
- 진행률 페이지: https://claude.ai/artifact/6sH8vdW4FcEFsLpnzu9xec
- 다른 계정에선 공유받지 않으면 못 열고, 고쳐 올리려면 편집 권한이 필요 — 안 되면 새 Artifact 로 올리고 사용자에게 새 링크를 줄 것.

### 0-4. 그 밖의 대기
- 잠금화면 카드가 사용자 폰에서 안 보이는 문제(7절 '이어서 할 것') — 사용자가 "나중에" 하자고 함.
- 도구: Deno 는 `npm i deno`(스크래치 폴더에), Playwright 는 `npm i playwright-core@1.56.1` + `executablePath: '/opt/pw-browsers/chromium'`.
- 사용자 방식: 오래 걸리는 일은 진행률을 알려 주길 원함, 완료되면 PushNotification.

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

## 9. 테마·배경 구조

- 테마 목록 `src/lib/palettes.ts`, 고르는 칸 `PalettePicker.tsx`(☰ 메뉴·설정 → 화면·데이터), 색 `globals.css`:
  단색 테마는 `html[data-palette=X]:not([data-theme="dark"])`(밝게) / `html[data-palette=X][data-theme="dark"]`(어둡게) 로
  포인트색·바탕 색조만 덮는다(라임 = 기본 :root 값). 새 테마는 이 두 블록 + `palettes.ts` 한 줄 + `types.ts` 의 palette 타입에 추가.
- 사진 배경(`dusk`)의 '내 사진': `src/lib/customBg.ts` — 긴 쪽 2560px webp 로 줄여 **이 기기 IndexedDB 에만** 저장
  (`settings.background = "custom"`). 다른 기기에서는 기본 그림으로 보이고 거기서 따로 넣으면 된다. `Backdrop.tsx`·`BackgroundPicker.tsx`.
- 알람 화면(`AlarmOverlay.tsx`)은 테마와 상관없이 일부러 라임/빨강 고정.

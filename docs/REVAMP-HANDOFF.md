# 화면 개편 — 인수인계 (2026-10-07, 노트북 세션 → 클라우드 세션)

작업 브랜치: **`ui-revamp`** — `main` 에 push 하면 GitHub Pages(사용자가 폰에서 쓰는 실제 앱)로 자동 배포되므로,
개편이 끝나 화면을 확인하기 전까지 `main` 에 합치지 말 것.

## 사용자 요청 요약 (결정 완료)

사용자가 쓰던 폰 To-Do 앱처럼 화면을 바꾸기. 모든 결정은 사용자가 내렸다.

1. **탭 구조 — 폰·PC 둘 다**: ☰(메뉴) · 작업 · 캘린더 · 내 것.
   폰은 하단 탭바 + 오른쪽 아래 둥근 + 버튼. PC(넓은 화면)는 왼쪽 세로 레일(메뉴 내용을 항상 펼쳐 둠) + 넓은 본문.
   지금의 여러 패널 대시보드(`src/components/Dashboard.tsx`)는 이 구조로 대체.
2. **☰ 메뉴**: 별표 작업, 카테고리 목록(개수 표시 + 새로 만들기·이름 바꾸기·색·삭제), 습관, 테마, 설정.
3. **카테고리**: 기본 작업·개인·위시리스트·생일(+ '모두' 보기) + 사용자 추가.
4. **작업 탭**: 위쪽 카테고리 칩 가로 스크롤, 목록형 할 일, 별표, "오늘 완료 (n)" 접히는 묶음,
   "완료된 모든 작업 확인". 시간 없는 할 일 지원. 맨 위에 지금/다음 카운트다운/오늘 달성률(기존 NowBar) 유지.
5. **캘린더 탭**: 월 달력 + 할 일 있는 날 점 + 노트 있는 날 다른 색 점. 날짜 누르면 아래(PC는 오른쪽)에 그날 목록 +
   **하루 노트**(그날 할 것·생각·느낌 자유 입력, 기분 이모지 5단계, 자동 저장). 기존 Timeline 은 일/주 상세 보기로 유지.
6. **내 것 탭(통계)**: 완료한 작업 수, 완벽한 하루(그날 할 일 전부 완료한 날 수), 연간 히트맵, 카테고리별 완료 도넛(30일),
   요일별 완료 막대(주간 + 한 줄 코멘트), 완료율·가장 생산적인 요일, 집중 시간 주간 차트, 향후 7일.
   기존 변명 노트(LogSheet 내용)·습관 스트릭도 여기로. 차트는 dataviz 스킬 지침을 따른다.
7. **테마**: 사용자가 준 노을·그네 사진의 분위기를 직접 다시 그린 그림 — **완료**.
8. **브리핑 알림 2종**
   - 노트북 켤 때: 앱이 켜질 때(세션 첫 실행) "오늘 일정 n개 · 첫 일정 · 미시작 n건" 시스템 알림 + 앱 안 카드
     (설정 `launchBriefing`, 기본 켜짐). Windows 시작 프로그램 바로가기 등록은 **노트북에서만 가능** — 클라우드에선 하지 말고 남겨 둘 것.
   - 폰 매일 오전 10시: 서버 푸시. `push_subscriptions` 에 기기 이름·`briefing_time`('HH:MM')·`last_briefing_on` 추가,
     설정 → 알림에 "이 기기 아침 브리핑 시각"(폰 기본 10:00, 노트북 끔). 기존 1분 크론(send-due-notifications)이 처리,
     하루 1회, 사용자 시간대 기준. Edge Function 재배포 필요(Supabase MCP 의 deploy_edge_function, `_shared/push.ts` 포함 3개 파일 구조 그대로).
9. **그다음 단계(개편 뒤)**: 음성으로 일정 넣기. 사용자 핵심 요구는 "개떡같이 말해도 찰떡같이 알아듣는 AI".
   브라우저 음성인식 → Supabase Edge Function 에서 Claude API(키는 Vault) → 미리보기 확인 후 저장. API 키는 사용자가 발급해야 함.

## 이미 된 것 (이 브랜치)

- 그림: `scripts/gen-background.mjs` → `public/themes/dusk-portrait.webp`(1080×2340), `dusk-landscape.webp`(2400×1350).
  원본 사진과 SVG 원본은 `design/`(gitignore — 출처 미확인 사진이라 공개 저장소에 올리지 않음).
- 데이터: `src/lib/types.ts`(Category, DayNote, Task.schedule/category_id/starred, Settings.palette/launchBriefing),
  `src/lib/ids.ts`(결정적 id: 기본 카테고리·하루 노트), `src/lib/store.ts`(새 테이블·기본 카테고리 생성·로컬→계정 id 재매핑),
  `src/lib/planner.ts`(isTimed/tasksOnDay/completedOn/liveCategories/dayNoteFor, createTask(schedule…), toggleStar,
  카테고리 CRUD, saveDayNote). 알림·강제는 `schedule === "timed"` 에만.
- DB: `supabase/migrations/20261007000000_categories_notes.sql` — **실제 서버에 이미 적용됨**(다시 적용해도 안전하게 작성).
  테스트 `npm run test:db` 전부 통과.
- 테마 색: `globals.css` 의 `html[data-palette="dusk"]` 토큰, `layout.tsx`·`PlannerProvider` 가 data-palette 적용,
  `src/components/Backdrop.tsx`(배경 그림) — **아직 화면에 붙이지 않음**(새 셸에 넣을 것).

## 남은 순서

1. 새 셸(탭바·PC 레일·☰ 드로어) + Backdrop 붙이기 → 2. 작업 탭(+ 빠른 추가, TaskEditor 에 종류·카테고리·별표)
→ 3. 캘린더 탭 + 하루 노트 → 4. 내 것 탭 → 5. 브리핑 2종(서버 쪽은 마이그레이션 + 함수 재배포)
→ 6. 화면 확인(폰·PC 크기) → 7. `main` 에 합쳐 배포.

## 주의

- **Next.js 16** — 코드 쓰기 전에 `node_modules/next/dist/docs/` 의 해당 문서 확인(AGENTS.md).
- **소리 테스트는 음량 0부터** — 알람이 반복 재생되면 사용자가 싫어함. 테스트 뒤 브라우저 탭·서버 정리.
- 하위 경로 배포(`/Schedule_app`) — 절대 경로는 `withBase()` 로. 서비스 워커는 자기 위치에서 접두어를 계산.
- Supabase 프로젝트 `gcnosxcojuefkaaxefug`(서울, 무료). **1인 전용**(첫 가입자만) — 테스트용 계정을 만들지 말 것(주인이 이미 있음).
  비밀값은 Vault(`must_*`)에만. 보안 점검 경고 1건(유출 비밀번호 보호 꺼짐)은 대시보드 Auth 설정이라 사용자에게 안내만.
- 검증: `npx tsc --noEmit`, `npx eslint src`, `npm run test:db`, `npm run build`. 한글 줄바꿈은 `word-break: keep-all`.
- 커밋 작성자: `C2K-ai <338173723+C2K-ai@users.noreply.github.com>`(공개 저장소에 개인 메일 노출 방지).

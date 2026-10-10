@AGENTS.md

# DREAM (예전 이름 MUST) — 개인 플래너 PWA

## 이어받기 (새 세션은 여기부터)
- 작업 브랜치는 **`ui-revamp`** (배포는 `main`). 다른 브랜치에서 시작했으면 먼저 `git fetch origin ui-revamp && git checkout ui-revamp`.
- 그다음 **`docs/HANDOFF.md` 0절**(지금 하는 일)만 읽고 이어서 한다. 2절(일하는 방식)은 아래에 옮겨 두었다.
  기능 → 파일 표는 3장, 나머지 장은 필요할 때만.
- 단계가 끝날 때마다 HANDOFF.md 0절을 고쳐 `ui-revamp` 에 올린다(토큰이 떨어지면 다른 계정이 이어받음).
  **0절에는 진행 중·대기인 일만** 둔다 — 끝난 일은 8절(최근에 한 일)에 한 줄로 옮기고 0절에서 지운다.

**공개 저장소** — 비밀값(Vault 키)·`design/` 사진은 커밋하지 않는다. 앱 공개 키는 `.env.production` 에만.

## 일하는 방식
- 한국어, 쉬운 말, 결과 위주. 화면 문구는 "~해요" 체, 코드 주석도 한국어로 짧게.
- 허락 묻지 말고 끝까지 해서 배포한 뒤 보고. 단 파일·데이터 삭제, 로그인·자격증명을 쓰는 단계는 먼저 묻는다.
- 사용자가 직접 눌러야 할 게 생기면 PushNotification 으로 알린다.
- 알람·소리 테스트 전엔 앱 설정 음량 0(음성 안내도 끔). 끝나면 탭을 about:blank 로 보내고 개발 서버를 끈다.

## 사용량 아끼기 (Pro — 클라우드 세션도 같은 한도를 쓴다)
- 서브에이전트·검토/진단 워크플로는 사용자가 요청할 때만. 요청을 받아도 규모(몇 명)를 한 줄로 알리고 작게 시작한다
  (검토 1~2명, 반박 검증은 찾은 문제에만). 10-09 검토는 24명이었고, 5명 진단은 한도에 걸려 결과 없이 멈췄다.
- 측정·진단 결과는 스크래치가 아니라 HANDOFF.md 0절(또는 `docs/`)에 바로 적고 올린다 — 세션이 끊기면 스크래치는 사라져 같은 일을 다시 한다.
- 클라우드 세션: `node_modules` 는 SessionStart hook(`scripts/cloud-setup.sh`)이 깔아 둔다 — 다시 깔지 말 것.
  화면 확인·네트워크 우회 요령은 HANDOFF.md 5장.
- `package-lock.json`·`*.tsbuildinfo` 는 통째로 읽지 않는다(버전은 `npm ls <패키지>`).

## 배포
- 순서: `git push origin ui-revamp` → `git push origin ui-revamp:main`(GitHub Pages 자동 배포, basePath `/Schedule_app`)
  → `gh run list --workflow pages.yml` 로 성공 확인. 로컬 `main` 은 오래됐을 수 있다 — 기준은 `origin/main`.
- 커밋: `--author "C2K-ai <338173723+C2K-ai@users.noreply.github.com>"`, 메시지는 한국어로 무엇이 바뀌었는지.
- push 403 = GCM 기본 로그인이 옛 계정이라서. origin URL 에 `C2K-ai@` 가 붙어 있어야 한다.

## 검사 (바꾼 뒤 항상)
- `npx tsc --noEmit` · `npx eslint src` · `npm run test:unit` · `npm run test:db`(PGlite 로 마이그레이션 실제 실행)
- Edge: `cd supabase/functions && deno test --config deno.json --allow-env --allow-net .` (deno 없으면 `npm i --no-save deno`)
- 화면(노트북): `.claude/launch.json` 의 `must-dev`(3000) / `must-prod`(4173, 빌드 결과)

## 함정
- DB 변경 = 새 마이그레이션 파일 + Supabase MCP `apply_migration`(프로젝트 `gcnosxcojuefkaaxefug`) + `supabase/tests/schema.test.mjs` 에 테스트.
  `DROP`·`DELETE FROM`·`TRUNCATE` 가 있으면 MCP 가 승인 창에서 멈춘다 → `create or replace`·`if not exists` 로 피하고, 다시 돌려도 안전하게.
- Edge 배포: MCP `deploy_edge_function`, `import_map_path: "deno.json"`, files 에 `deno.json`·`_shared/env.ts`(+쓰는 `_shared/*`) 포함.
- `public/sw.js` 를 고치면 `VERSION` 을 올린다 — 안 올리면 설치된 앱이 옛 버전 그대로.
- ESLint `react-hooks`: 렌더 중 `Date.now()`·`Math.random()` 금지, effect 안 setState 금지.
- 데이터는 로컬 우선(`src/lib/store.ts`, localStorage 키 `must:`) + 로그인하면 Supabase 동기화(LWW, `updated_at`).

#!/bin/bash
# 클라우드 세션 시작 때 의존성을 미리 깔아 둔다 — Claude 가 턴을 써서 직접 깔지 않게.
# 로컬(노트북)에서는 바로 끝난다. 여기 stdout 은 Claude 컨텍스트에 들어가므로 한 줄만 출력한다.

[ "$CLAUDE_CODE_REMOTE" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
[ -d node_modules ] && exit 0

if npm ci --no-audit --no-fund >/tmp/npm-ci.log 2>&1; then
  echo "[cloud-setup] npm ci 완료 — node_modules 준비됨"
else
  echo "[cloud-setup] npm ci 실패 — /tmp/npm-ci.log 확인"
fi
exit 0

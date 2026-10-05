/**
 * 하위 경로 배포용 접두어 — GitHub Pages 는 https://<계정>.github.io/<저장소>/ 아래에 올라간다.
 * 빌드할 때 NEXT_PUBLIC_BASE_PATH=/Schedule_app 처럼 주면 모든 절대 경로 앞에 붙는다. 루트 배포면 빈 문자열.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const withBase = (path: string) => `${BASE_PATH}${path}`;

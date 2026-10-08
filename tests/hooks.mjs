// 모듈 훅 — 확장자 없는 상대 import 에 .ts 를 붙여 준다(Next 번들러와 같은 방식)
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

export async function resolve(spec, ctx, next) {
  if ((spec.startsWith("./") || spec.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(spec)) {
    try {
      return await next(spec + ".ts", ctx);
    } catch {
      // .ts 가 아니면 원래대로
    }
  }
  return next(spec, ctx);
}

// store.ts 는 생성자 매개변수 속성(readonly scope …)을 써서 타입 지우기만으론 안 된다 → 그 파일만 변환 모드로.
// 일기 파일(diary*.ts)은 반드시 타입 지우기만으로 돌아야 하므로 여기서 봐주지 않는다.
export async function load(url, ctx, next) {
  try {
    return await next(url, ctx);
  } catch (e) {
    if (e?.code !== "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX" || !url.endsWith(".ts") || /\/diary[^/]*\.ts$/.test(url)) throw e;
    const src = await readFile(new URL(url), "utf8");
    return { format: "module", source: stripTypeScriptTypes(src, { mode: "transform" }), shortCircuit: true };
  }
}

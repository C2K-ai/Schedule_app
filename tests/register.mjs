// node --import ./tests/register.mjs — src/lib 의 .ts 를 Node 내장 타입 지우기로 바로 불러온다(새 의존성 없음)
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);

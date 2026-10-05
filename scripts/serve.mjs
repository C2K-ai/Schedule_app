// 빌드 결과(out/)를 띄우는 초간단 정적 서버 — 의존성 없음.
//   npm run build && npm run serve   →  http://localhost:4173
// localhost 는 보안 컨텍스트라 서비스 워커·알림·푸시를 그대로 시험할 수 있다.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)), "out");
const port = Number(process.env.PORT ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
};

if (!existsSync(root)) {
  console.error("out/ 폴더가 없습니다. 먼저 `npm run build` 를 실행하세요.");
  process.exit(1);
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  if (rel.includes("..")) {
    res.writeHead(400).end();
    return;
  }
  let file = join(root, rel);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
  if (!existsSync(file)) {
    res.writeHead(404, { "content-type": TYPES[".html"] });
    createReadStream(join(root, "404.html")).pipe(res);
    return;
  }
  const headers = { "content-type": TYPES[extname(file)] ?? "application/octet-stream" };
  if (file.endsWith("sw.js")) headers["cache-control"] = "no-cache";
  else if (url.pathname.startsWith("/_next/static/")) headers["cache-control"] = "public, max-age=31536000, immutable";
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`MUST → http://localhost:${port}`));

import type { NextConfig } from "next";

// 정적 내보내기(out/) — 서버 없이 Vercel·Netlify·Cloudflare Pages 어디든 올릴 수 있다.
// 서버 쪽 일(푸시 발송·습관 생성)은 전부 Supabase(pg_cron + Edge Function)가 맡는다.
const nextConfig: NextConfig = {
  output: "export",
  // GitHub Pages 처럼 하위 경로에 올릴 때 (예: /Schedule_app). 비우면 루트.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;

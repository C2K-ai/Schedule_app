import type { NextConfig } from "next";

// 정적 내보내기(out/) — 서버 없이 Vercel·Netlify·Cloudflare Pages 어디든 올릴 수 있다.
// 서버 쪽 일(푸시 발송·습관 생성)은 전부 Supabase(pg_cron + Edge Function)가 맡는다.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;

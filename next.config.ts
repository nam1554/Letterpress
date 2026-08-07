import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Forward all browser console output to the terminal (Next 16.2 AI tooling)
  logging: {
    browserToTerminal: true,
  },
  // Next 16.3 Instant Navigations — 미래 메이저의 기본값을 미리 채택 (16.3 블로그).
  // 이 앱은 클라이언트 페이지 중심이라 체감 이득은 작지만, 기본값 전환 때
  // 한꺼번에 깨지는 것보다 지금 검증해 두는 편이 싸다.
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;

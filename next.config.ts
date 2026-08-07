import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Forward all browser console output to the terminal (Next 16.2 AI tooling)
  logging: {
    browserToTerminal: true,
  },
  // Next 16.3 — 미래 메이저의 기본값(명시적 캐시 모델)을 미리 채택 (16.3 블로그).
  // 이 앱은 클라이언트 페이지 중심이라 체감 이득은 작지만, 기본값 전환 때
  // 한꺼번에 깨지는 것보다 지금 검증해 두는 편이 싸다.
  cacheComponents: true,
  // partialPrefetching은 16.3.0에서 보류: 함께 켜지는 Instant Insights 검증
  // 렌더가 Next 자체 버그(Invariant: Cannot access "moduleLoading" without a
  // work store — "This is a bug in Next.js")를 치면서 dev 로그에 GET / 500과
  // MantineProvider 오류를 남기고, instrumentation을 타고 진단 번들
  // (data/logs/app.log)까지 오염시킨다(실측 4건). 버그 수정 릴리스에서 재시도.
};

export default nextConfig;

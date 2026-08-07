import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // 기계적 일괄 수정(예: 라우트 세그먼트 설정 제거)이 남긴 2연속 빈 줄이
      // 18개 파일에 퍼졌는데 잡는 규칙이 없었다(2026-08-07 티어드 리뷰 실측).
      // 저장소 스타일은 빈 줄 1개다 — 재발을 lint로 막는다.
      "no-multiple-empty-lines": ["warn", { max: 1, maxBOF: 0, maxEOF: 0 }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

/**
 * 백엔드 연동 진단의 공개 표면 — 구현은 lib/setup/ 아래 세 모듈로 나뉜다:
 *   parsers.ts  — `mcp list` 출력 파서 (순수 함수, setup.test.ts가 검증)
 *   backends.ts — 백엔드별 진단 단계 + getBackendSetup 캐시
 *   test-run.ts — "연동 테스트" (실제 CLI 스폰, in-flight 합류)
 *   validate.ts — 키 저장 시 즉시 검증 (Figma 토큰)
 * 임포트 경로는 이 파사드(@/lib/setup)로 고정한다 — 새 백엔드를 추가할 때
 * 고치는 곳은 backends.ts의 `<id>Setup()` + getBackendSetup 로스터다.
 */
export {
  figmaMcpFromClaudeList,
  figmaMcpFromCodexList,
  type McpStatus,
} from "./setup/parsers";
export {
  figmaTokenStep,
  getBackendSetup,
  type BackendSetup,
  type SetupStep,
} from "./setup/backends";
export { runBackendTest, type BackendTestResult } from "./setup/test-run";
export { validateFigmaToken, type KeyCheck } from "./setup/validate";

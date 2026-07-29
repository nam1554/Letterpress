import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 라우트 핸들러를 그대로 import해 테스트하려면 tsconfig의 "@/*" 별칭이
// 필요하다 (vitest는 tsconfig paths를 읽지 않는다).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// apps/api/vitest.config.ts와 통일된 스타일(globals: false, 명시적 import) 유지.
// 기본 환경은 jsdom(RTL 렌더링용)이며, next/server(NextRequest/NextResponse)를
// 직접 사용하는 미들웨어/Route Handler 테스트는 파일 상단 `// @vitest-environment node`
// 주석으로 개별 오버라이드한다.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});

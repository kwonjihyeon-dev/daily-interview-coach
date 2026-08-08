import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// vitest.config.ts에서 globals: false로 설정했기 때문에 @testing-library/react가
// afterEach를 전역에서 자동으로 찾아 등록하는 auto cleanup이 동작하지 않는다.
// 각 테스트 사이에 렌더링된 DOM이 누적되는 것을 막기 위해 명시적으로 등록한다.
afterEach(() => {
  cleanup();
});

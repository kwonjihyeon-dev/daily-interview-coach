import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md
 * "인증된 apps/api 호출 래퍼 (apps/web/src/lib/authenticatedFetch.ts)" 절.
 *
 * `next/headers`(쿠키 읽기/삭제)와 `next/navigation`(redirect)을 모킹해 Route Handler /
 * Server Action 컨텍스트를 흉내낸다. `redirect()`는 실제로는 예외를 던져 실행을 중단시키지만,
 * 여기서는 "어떤 인자로 호출되는가"만 검증한다(실제 흐름 중단 여부는 Next.js 프레임워크의
 * 책임이며 이 유닛 테스트의 범위를 넘어선다).
 */

const cookieStoreMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: () => cookieStoreMock,
}));

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

const fetchMock = vi.hoisted(() => vi.fn());

import { authenticatedFetch } from "./authenticatedFetch";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_BASE_URL", "http://api.internal:3001");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("authenticatedFetch", () => {
  describe("정상 시나리오", () => {
    it("쿠키가 있으면 x-user-email 헤더를 붙여 apps/api를 호출하고 그 응답을 그대로 반환한다", async () => {
      // Given
      cookieStoreMock.get.mockReturnValue({ value: "user@example.com" });
      const upstream = { ok: true, status: 200, json: async () => ({ question: null }) };
      fetchMock.mockResolvedValue(upstream);

      // When
      const res = await authenticatedFetch("/api/questions/today", undefined, "/");

      // Then
      expect(res).toBe(upstream);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe("http://api.internal:3001/api/questions/today");
      expect((calledInit.headers as Record<string, string>)["x-user-email"]).toBe(
        "user@example.com",
      );
      expect(redirectMock).not.toHaveBeenCalled();
    });

    it("init으로 전달한 기존 헤더를 유지하면서 x-user-email 헤더를 추가한다", async () => {
      // Given
      cookieStoreMock.get.mockReturnValue({ value: "user@example.com" });
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

      // When
      await authenticatedFetch(
        "/api/sources/resume",
        { method: "POST", headers: { "x-custom": "1" } },
        "/upload",
      );

      // Then
      const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = calledInit.headers as Record<string, string>;
      expect(headers["x-custom"]).toBe("1");
      expect(headers["x-user-email"]).toBe("user@example.com");
      expect(calledInit.method).toBe("POST");
    });
  });

  describe("엣지 케이스", () => {
    it("쿠키가 없으면 apps/api를 호출하지 않고 '/gate?next=<현재 경로>'로 리다이렉트한다", async () => {
      // Given
      cookieStoreMock.get.mockReturnValue(undefined);

      // When
      await authenticatedFetch("/api/questions/today", undefined, "/history");

      // Then
      expect(fetchMock).not.toHaveBeenCalled();
      expect(redirectMock).toHaveBeenCalledWith("/gate?next=%2Fhistory");
    });

    it("currentPath를 생략하면 기본값 '/'를 기준으로 리다이렉트한다", async () => {
      // Given
      cookieStoreMock.get.mockReturnValue(undefined);

      // When
      await authenticatedFetch("/api/questions/today");

      // Then
      expect(redirectMock).toHaveBeenCalledWith("/gate?next=%2F");
    });
  });

  describe("에러 케이스", () => {
    it("apps/api가 401을 반환하면 쿠키를 삭제하고 '/gate?reason=expired&next=<현재 경로>'로 리다이렉트한다", async () => {
      // Given: 쿠키는 형식상 유효했으나 그 사이 users 테이블에서 삭제된 상태
      cookieStoreMock.get.mockReturnValue({ value: "user@example.com" });
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: "unauthorized" }),
      });

      // When
      await authenticatedFetch("/api/questions/today", undefined, "/history");

      // Then
      expect(cookieStoreMock.delete).toHaveBeenCalledWith("dic_visitor_email");
      expect(redirectMock).toHaveBeenCalledWith("/gate?reason=expired&next=%2Fhistory");
    });
  });
});

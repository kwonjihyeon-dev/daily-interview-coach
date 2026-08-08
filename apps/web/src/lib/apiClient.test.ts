import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md (v2)
 * "신규: apps/web/src/lib/apiClient.ts (SSR 전용 헬퍼, 함수형)" 절.
 *
 * 이 파일은 v1 `authenticatedFetch`와 이번 기능의 중간 산출물이었던 `forwardedApiFetch`
 * (단일 함수, `Response`를 그대로 반환하는 설계 — 삭제됨)를 완전히 대체하는 최종 설계를
 * 검증한다. 확정된 설계:
 *
 * - **클래스가 아니라 함수형**. 캡슐화가 필요한 공용 내부 로직(`request`)은 export하지
 *   않는 모듈 스코프 함수로 감춘다 — 공개 인터페이스는 `apiGet`/`apiPost`/`apiPut`/
 *   `apiDelete` 4개뿐이며, 이 테스트도 그 비공개 함수를 직접 건드리지 않고 4개의 public
 *   함수를 통해서만 검증한다.
 * - 반환 타입이 `Response`가 아니라 판별 유니온 `ApiResult`:
 *   `{ kind: "ok"; response: Response } | { kind: "unauthenticated"; redirectTo: string }`.
 * - 401을 감지해도 `redirect()`를 직접 호출하지 않는다(넓은 try/catch가 리다이렉트 신호를
 *   삼킬 위험 방지) — 이 모듈은 `next/navigation`을 아예 import하지 않는다(설계의 핵심이므로
 *   런타임 동작뿐 아니라 소스 텍스트 자체도 정적으로 검사한다).
 * - `import "server-only"`가 파일 최상단에 있어야 한다(클라이언트 오import 방지, 빌드
 *   시점 에러). 이 요구사항은 런타임 mock만으로는 검증할 수 없으므로 소스 텍스트를
 *   정적으로 검사한다.
 *
 * `server-only` 패키지는 실제 설치 여부와 무관하게 빈 모듈로 모킹한다 — 이 단위 테스트는
 * "import 문이 소스에 존재하는가"만 정적으로 검증하면 충분하고, 실제 패키지 설치(및
 * `next build` 시점의 실제 오import 방지 효과)는 developer 단계의 책임이다.
 */

vi.mock("server-only", () => ({}));

const headersMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: () => headersMock,
}));

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

const fetchMock = vi.hoisted(() => vi.fn());

import { apiDelete, apiGet, apiPost, apiPut } from "./apiClient";

const API_BASE_URL = "http://api.internal:3001";

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function readApiClientSource(): string {
  return readFileSync(path.join(process.cwd(), "src/lib/apiClient.ts"), "utf-8");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_BASE_URL", API_BASE_URL);
  headersMock.get.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("apiClient 정적 계약 (소스 텍스트 검사 — 런타임 mock으로 검증 불가능한 부분)", () => {
  it("파일 최상단에 'server-only'를 import한다(클라이언트 오import 시 빌드 에러를 내기 위함)", () => {
    expect(readApiClientSource()).toMatch(/import\s+["']server-only["'];?/);
  });

  it("'next/navigation'을 import하지 않는다(redirect() 호출은 이 모듈이 아니라 호출부의 책임)", () => {
    expect(readApiClientSource()).not.toContain("next/navigation");
  });

  it("내부 공용 함수(request)를 export하지 않는다 — apiGet/apiPost/apiPut/apiDelete만 공개 인터페이스다", () => {
    const source = readApiClientSource();
    expect(source).not.toMatch(/export\s+(async\s+)?function\s+request\b/);
    expect(source).not.toMatch(/export\s+const\s+request\b/);
  });
});

describe("apiGet / apiPost / apiPut / apiDelete", () => {
  describe("정상 시나리오", () => {
    it.each([
      ["apiGet", apiGet, "GET"],
      ["apiPost", apiPost, "POST"],
      ["apiPut", apiPut, "PUT"],
      ["apiDelete", apiDelete, "DELETE"],
    ] as const)("%s는 %s 메서드로 fetch를 호출한다", async (_name, fn, method) => {
      // Given
      fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

      // When
      await fn("/api/questions/today");

      // Then
      const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(calledInit.method).toBe(method);
    });

    it("들어온 요청의 Cookie 헤더를 그대로 apps/api 요청에 실어 보낸다", async () => {
      // Given
      headersMock.get.mockImplementation((name: string) =>
        name === "cookie" ? "dic_visitor_email=user@example.com" : null,
      );
      fetchMock.mockResolvedValue(jsonResponse(200, { question: null }));

      // When
      await apiGet("/api/questions/today");

      // Then
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe(`${API_BASE_URL}/api/questions/today`);
      expect((calledInit.headers as Record<string, string>).cookie).toBe(
        "dic_visitor_email=user@example.com",
      );
    });

    it("401이 아닌 응답이면 { kind: 'ok', response }를 반환한다", async () => {
      // Given
      const upstream = jsonResponse(200, { question: null });
      fetchMock.mockResolvedValue(upstream);

      // When
      const result = await apiGet("/api/questions/today");

      // Then
      expect(result).toEqual({ kind: "ok", response: upstream });
    });

    it("404 등 401이 아닌 에러 응답도 가공 없이 { kind: 'ok', response }로 그대로 전달한다", async () => {
      // Given
      const upstream = jsonResponse(404, { error: "not_found" });
      fetchMock.mockResolvedValue(upstream);

      // When
      const result = await apiGet("/api/sources/999");

      // Then
      expect(result).toEqual({ kind: "ok", response: upstream });
    });
  });

  describe("엣지 케이스", () => {
    it("currentPath를 생략하면 기본값 '/'를 기준으로 redirectTo를 만든다(401 상황)", async () => {
      // Given
      fetchMock.mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));

      // When
      const result = await apiGet("/api/questions/today");

      // Then
      expect(result).toEqual({
        kind: "unauthenticated",
        redirectTo: "/gate?reason=expired&next=%2F",
      });
    });

    it("currentPath를 지정하면 redirectTo에 그 경로가 인코딩되어 반영된다", async () => {
      // Given
      fetchMock.mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));

      // When
      const result = await apiPost("/api/answers", undefined, "/history");

      // Then
      expect(result).toEqual({
        kind: "unauthenticated",
        redirectTo: "/gate?reason=expired&next=%2Fhistory",
      });
    });

    it("init으로 전달한 기존 헤더/바디를 유지하면서 cookie 헤더를 추가한다", async () => {
      // Given
      headersMock.get.mockImplementation((name: string) =>
        name === "cookie" ? "dic_visitor_email=user@example.com" : null,
      );
      fetchMock.mockResolvedValue(jsonResponse(200, {}));

      // When
      await apiPost("/api/sources/resume", {
        headers: { "x-custom": "1" },
        body: JSON.stringify({ a: 1 }),
      });

      // Then
      const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = calledInit.headers as Record<string, string>;
      expect(headers["x-custom"]).toBe("1");
      expect(headers.cookie).toBe("dic_visitor_email=user@example.com");
      expect(calledInit.body).toBe(JSON.stringify({ a: 1 }));
      expect(calledInit.method).toBe("POST");
    });
  });

  describe("에러 케이스", () => {
    it("Cookie 헤더 자체가 없으면(headers().get('cookie')가 null) 빈 문자열을 그대로 전달한다(방어적으로 가공하지 않음)", async () => {
      // Given
      headersMock.get.mockReturnValue(null);
      fetchMock.mockResolvedValue(jsonResponse(401, {}));

      // When
      await apiGet("/api/questions/today");

      // Then
      const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((calledInit.headers as Record<string, string>).cookie).toBe("");
    });

    it("401 응답을 받아도 next/navigation의 redirect()를 직접 호출하지 않는다(호출부 책임 — 판별 유니온으로만 신호를 전달)", async () => {
      // Given: 쿠키는 형식상 유효했으나 그 사이 users 테이블에서 삭제된 상태를 가정
      headersMock.get.mockImplementation((name: string) =>
        name === "cookie" ? "dic_visitor_email=user@example.com" : null,
      );
      fetchMock.mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));

      // When
      const result = await apiGet("/api/questions/today", undefined, "/history");

      // Then
      expect(redirectMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        kind: "unauthenticated",
        redirectTo: "/gate?reason=expired&next=%2Fhistory",
      });
    });
  });
});

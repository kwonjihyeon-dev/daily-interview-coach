// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md
 * "Next.js Route Handler (apps/web/src/app/api/gate/verify/route.ts)" 절.
 *
 * 업스트림 apps/api 호출은 global fetch를 모킹해 대체한다. 이 라우트는 next/server의
 * NextRequest/NextResponse에 의존하므로 파일 상단에서 node 환경으로 강제한다.
 */

const fetchMock = vi.hoisted(() => vi.fn());

function buildRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/gate/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function upstreamResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_BASE_URL", "http://api.internal:3001");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe("POST /api/gate/verify", () => {
  describe("정상 시나리오", () => {
    it("업스트림이 200을 반환하면 쿠키를 발급하고 { ok: true }를 200으로 반환한다", async () => {
      // Given
      fetchMock.mockResolvedValue(upstreamResponse(200, { verified: true }));

      // When
      const res = await POST(buildRequest({ email: "user@example.com" }));
      const body = await res.json();

      // Then
      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true });

      const cookie = res.cookies.get("dic_visitor_email");
      expect(cookie).toBeDefined();
      expect(cookie?.value).toBe("user@example.com");
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite).toBe("lax");
      expect(cookie?.path).toBe("/");
      expect(cookie?.maxAge).toBe(15552000);
    });

    it("업스트림 호출 시 API_BASE_URL 환경변수 기반 URL과 이메일 body를 그대로 전달한다", async () => {
      // Given
      fetchMock.mockResolvedValue(upstreamResponse(200, { verified: true }));

      // When
      await POST(buildRequest({ email: "user@example.com" }));

      // Then
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe("http://api.internal:3001/api/auth/verify-email");
      expect(calledInit.method).toBe("POST");
      expect(JSON.parse(calledInit.body as string)).toEqual({ email: "user@example.com" });
    });
  });

  describe("엣지 케이스", () => {
    it("대소문자/공백이 섞인 이메일도 정규화된 값으로 쿠키를 발급한다", async () => {
      // Given
      fetchMock.mockResolvedValue(upstreamResponse(200, { verified: true }));

      // When
      const res = await POST(buildRequest({ email: " User@Example.com " }));

      // Then
      expect(res.cookies.get("dic_visitor_email")?.value).toBe("user@example.com");
    });

    it("업스트림이 400 email_required를 반환하면 동일한 상태코드/바디를 그대로 전달하고 쿠키를 발급하지 않는다", async () => {
      // Given
      fetchMock.mockResolvedValue(
        upstreamResponse(400, { error: "email_required", message: "이메일을 입력해주세요." }),
      );

      // When
      const res = await POST(buildRequest({ email: "   " }));
      const body = await res.json();

      // Then
      expect(res.status).toBe(400);
      expect(body).toEqual({ error: "email_required", message: "이메일을 입력해주세요." });
      expect(res.cookies.get("dic_visitor_email")).toBeUndefined();
    });
  });

  describe("에러 케이스", () => {
    it("업스트림이 401 email_not_found를 반환하면 동일하게 전달하고 쿠키를 발급하지 않는다", async () => {
      // Given
      fetchMock.mockResolvedValue(
        upstreamResponse(401, {
          error: "email_not_found",
          message: "등록되지 않은 이메일입니다. 접근 권한이 있는 이메일인지 확인해주세요.",
        }),
      );

      // When
      const res = await POST(buildRequest({ email: "nobody@example.com" }));
      const body = await res.json();

      // Then
      expect(res.status).toBe(401);
      expect(body.error).toBe("email_not_found");
      expect(res.cookies.get("dic_visitor_email")).toBeUndefined();
    });

    it("업스트림이 500 internal_error를 반환하면 동일하게 전달하고 쿠키를 발급하지 않는다", async () => {
      // Given
      fetchMock.mockResolvedValue(
        upstreamResponse(500, {
          error: "internal_error",
          message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        }),
      );

      // When
      const res = await POST(buildRequest({ email: "user@example.com" }));
      const body = await res.json();

      // Then
      expect(res.status).toBe(500);
      expect(body.error).toBe("internal_error");
      expect(res.cookies.get("dic_visitor_email")).toBeUndefined();
    });

    it("업스트림 호출 자체가 실패하면(네트워크 오류) 502 upstream_unreachable을 반환하고 쿠키를 발급하지 않는다", async () => {
      // Given: apps/api가 응답하지 않는 상태
      fetchMock.mockRejectedValue(new Error("network error"));

      // When
      const res = await POST(buildRequest({ email: "user@example.com" }));
      const body = await res.json();

      // Then
      expect(res.status).toBe(502);
      expect(body).toEqual({
        error: "upstream_unreachable",
        message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      });
      expect(res.cookies.get("dic_visitor_email")).toBeUndefined();
    });
  });
});

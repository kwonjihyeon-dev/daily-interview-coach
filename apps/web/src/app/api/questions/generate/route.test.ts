// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * 대상 스펙: .claude/artifacts/spec/클라이언트-데이터-계층-전환_spec.md "설계 판단 3" +
 * Acceptance Criteria C의 에러 케이스.
 *
 * 이 Route Handler는 얇은 프록시라 로직이 거의 없다. 핵심 리스크는 딱 하나 —
 * **apps/api와의 응답 계약(상태 코드/JSON 바디 형태)이 어긋나면, 클라이언트
 * (ResumeUploadForm.tsx/EmptyQuestionState.tsx)의 기존 401 감지·에러 매핑 로직이
 * 조용히 깨진다**는 것이다. 그래서 이 테스트는 "정상 흐름을 여러 변형으로 늘리는"
 * 대신, 계약이 지켜지는지만 최소한으로 확인한다(행복 경로 1개 + 에러 경로 3개).
 *
 * `NextRequest`/`NextResponse`는 Web 표준 Request/Response 기반이라 jsdom 환경에서
 * 불필요한 충돌을 피하기 위해 이 파일은 node 환경으로 강제한다(proxy.test.ts와 동일한
 * 관례).
 */

const apiPostMock = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/apiClient", () => ({
  apiPost: apiPostMock,
}));

import { POST } from "./route";

function buildRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/questions/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function buildInvalidJsonRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/questions/generate", {
    method: "POST",
    body: "not-json",
  });
}

function fakeUpstreamResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/questions/generate (Route Handler)", () => {
  describe("정상 시나리오", () => {
    it("apiPost가 {kind:'ok'}를 반환하면 apps/api의 상태 코드와 JSON 바디를 그대로 통과시킨다", async () => {
      // Given
      const upstreamBody = {
        questions: [],
        question: {
          id: "q1",
          userId: "user-1",
          sourceId: "source-1",
          category: "카테고리",
          text: "질문 텍스트",
          origin: "ai",
          createdAt: "2026-08-12T09:00:00+09:00",
        },
      };
      apiPostMock.mockResolvedValue({
        kind: "ok",
        response: fakeUpstreamResponse(201, upstreamBody),
      });

      // When
      const res = await POST(buildRequest({ sourceId: "source-1" }));

      // Then
      expect(res.status).toBe(201);
      await expect(res.json()).resolves.toEqual(upstreamBody);
    });
  });

  describe("에러 케이스", () => {
    it("apiPost가 {kind:'unauthenticated'}를 반환하면 401과 {error:'unauthorized', message:'인증되지 않은 요청입니다.'}를 반환한다", async () => {
      // Given
      apiPostMock.mockResolvedValue({
        kind: "unauthenticated",
        redirectTo: "/gate?reason=expired&next=%2F",
      });

      // When
      const res = await POST(buildRequest({}));

      // Then
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({
        error: "unauthorized",
        message: "인증되지 않은 요청입니다.",
      });
    });

    it("apiPost 호출이 예외를 던지면(apps/api 프로세스 다운 등) 500과 일시적 오류 메시지를 반환한다", async () => {
      // Given
      apiPostMock.mockRejectedValue(new Error("ECONNREFUSED"));

      // When
      const res = await POST(buildRequest({ sourceId: "source-1" }));

      // Then
      expect(res.status).toBe(500);
      await expect(res.json()).resolves.toEqual({
        error: "internal_error",
        message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      });
    });

    it("요청 바디가 잘못된 JSON이면 apiPost를 호출하지 않고 400을 반환한다", async () => {
      // Given / When
      const res = await POST(buildInvalidJsonRequest());

      // Then
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        error: "invalid_request",
        message: "잘못된 요청입니다.",
      });
      expect(apiPostMock).not.toHaveBeenCalled();
    });
  });
});

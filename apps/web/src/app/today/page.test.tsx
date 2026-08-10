import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import type { Question } from "@daily-interview-coach/shared-types";
import TodayPage from "./page";

/**
 * 대상 스펙: .claude/artifacts/spec/질문-생성_spec.md (v2) "프론트엔드 — 신규 /today
 * 페이지" 절.
 *
 * `gate/page.test.tsx`와 동일한 방식으로, Server Component를 일반 async 함수로 직접
 * 호출(`await TodayPage()`)해 반환값(JSX 또는 redirect 호출)을 검증한다.
 * `apiClient.ts`의 `apiGet`은 모킹하고(실제 SSR fetch/쿠키 전달 상세는
 * `apiClient.test.ts`가 이미 검증함), 자식 Client Component `EmptyQuestionState`는
 * "렌더링되는지"만 확인하기 위한 스텁으로 모킹한다(그 컴포넌트 자체의 재생성 흐름은
 * `EmptyQuestionState.test.tsx`에서 별도로 검증하므로 중복하지 않는다).
 */

const apiGetMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/apiClient", () => ({ apiGet: apiGetMock }));

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("./EmptyQuestionState", () => ({
  EmptyQuestionState: () => <div data-testid="empty-question-state-stub" />,
}));

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function buildQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "question-id-1",
    userId: "user-1",
    sourceId: "source-id-1",
    category: "Next.js/SSR",
    text: "SSR의 트레이드오프에 대해 어떻게 생각하나요?",
    origin: "ai",
    createdAt: "2026-08-10T09:00:00+09:00",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TodayPage", () => {
  describe("정상 시나리오", () => {
    it("미답변 질문이 있으면 GET /api/questions/today를 호출하고 question.text를 렌더링한다", async () => {
      // Given
      const question = buildQuestion({ text: "이 프로젝트에서 가장 어려웠던 점은 무엇인가요?" });
      apiGetMock.mockResolvedValue({ kind: "ok", response: jsonResponse(200, { question }) });

      // When
      const jsx = await TodayPage();
      render(jsx as ReactElement);

      // Then
      expect(apiGetMock).toHaveBeenCalledWith(
        "/api/questions/today",
        undefined,
        "/today",
      );
      expect(apiGetMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText(question.text)).toBeInTheDocument();
      expect(screen.queryByTestId("empty-question-state-stub")).not.toBeInTheDocument();
    });
  });

  describe("엣지 케이스 (v2 — '질문 소진' 재생성 흐름)", () => {
    it("question이 null이면 EmptyQuestionState를 렌더링하고, GET /api/questions/today는 1회만 호출된다", async () => {
      // Given
      apiGetMock.mockResolvedValue({ kind: "ok", response: jsonResponse(200, { question: null }) });

      // When
      const jsx = await TodayPage();
      render(jsx as ReactElement);

      // Then
      expect(screen.getByTestId("empty-question-state-stub")).toBeInTheDocument();
      expect(apiGetMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("에러 케이스", () => {
    it("게이트 쿠키가 무효해 apiGet이 401(unauthenticated)을 감지하면 '/gate?reason=expired&next=%2Ftoday'로 리다이렉트한다", async () => {
      // Given
      apiGetMock.mockResolvedValue({
        kind: "unauthenticated",
        redirectTo: "/gate?reason=expired&next=%2Ftoday",
      });

      // When
      await TodayPage();

      // Then
      expect(redirectMock).toHaveBeenCalledWith("/gate?reason=expired&next=%2Ftoday");
    });

    it("GET /api/questions/today가 500을 반환하면 '질문을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'가 표시된다", async () => {
      // Given
      apiGetMock.mockResolvedValue({
        kind: "ok",
        response: jsonResponse(500, { error: "internal_error", message: "..." }),
      });

      // When
      const jsx = await TodayPage();
      render(jsx as ReactElement);

      // Then
      expect(
        screen.getByText("질문을 불러오지 못했습니다. 잠시 후 다시 시도해주세요."),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("empty-question-state-stub")).not.toBeInTheDocument();
    });
  });
});

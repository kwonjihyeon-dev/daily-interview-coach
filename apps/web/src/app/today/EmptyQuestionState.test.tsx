import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptyQuestionState } from "./EmptyQuestionState";

/**
 * 대상 스펙: .claude/artifacts/spec/질문-생성_spec.md (v2) "프론트엔드 — 신규 /today
 * 페이지 > EmptyQuestionState.tsx (Client Component, v2 신규)" 절,
 * .claude/artifacts/spec/클라이언트-데이터-계층-전환_spec.md "설계 판단 3" 절.
 *
 * `apiClient.ts`는 `import "server-only"`가 붙어 있어 Client Component에서 사용할 수
 * 없으므로(서버 전용), 질문 생성은 apps/web 자체의 Route Handler
 * (`/api/questions/generate`, 상대경로)를 거친다 — apps/api를 직접 호출하지 않으므로
 * `NEXT_PUBLIC_API_BASE_URL`도 `credentials:"include"`도 더 이상 필요 없다(동일 출처
 * 요청이라 브라우저가 쿠키를 기본으로 포함한다). props 없이 완전히 독립적으로 자체 상태
 * (`status`/`question`/`errorMessage`)를 관리하며, "다시 시도"는 `GET /api/questions/today`가
 * 아니라 `POST /api/questions/generate`를 `sourceId` 없이({}) 직접 호출한다(v2 확정 지침).
 */

const routerReplaceMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}));

const fetchMock = vi.hoisted(() => vi.fn());

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function pendingForever(): Promise<never> {
  return new Promise(() => undefined);
}

function retryButton() {
  return screen.getByRole("button", { name: "다시 시도" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EmptyQuestionState", () => {
  describe("정상 시나리오", () => {
    it("최초 렌더링(status=idle) 시 안내 문구와 '다시 시도' 버튼이 표시되고, 아무 요청도 보내지 않는다", () => {
      // Given / When
      render(<EmptyQuestionState />);

      // Then
      expect(
        screen.getByText("질문 생성에 문제가 있어요. 한번 더 시도해주세요"),
      ).toBeInTheDocument();
      expect(retryButton()).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("'다시 시도'를 클릭하면 GET /api/questions/today가 아니라 POST /api/questions/generate(상대경로)가 sourceId 없이({}) 호출되고, 버튼 텍스트가 '생성 중...'으로 바뀌며 비활성화된다", async () => {
      // Given
      fetchMock.mockReturnValue(pendingForever());
      render(<EmptyQuestionState />);
      const user = userEvent.setup();

      // When
      await user.click(retryButton());

      // Then
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/questions/generate");
      expect(options).toMatchObject({ method: "POST" });
      expect(options.credentials).toBeUndefined();
      expect(JSON.parse(options.body as string)).toEqual({});

      const loadingButton = await screen.findByRole("button", { name: "생성 중..." });
      expect(loadingButton).toBeDisabled();
    });

    it("생성이 201로 성공하면 별도의 GET /today 호출 없이 응답의 question.text가 그대로 렌더링된다", async () => {
      // Given
      fetchMock.mockResolvedValue(
        jsonResponse(201, {
          questions: [],
          question: {
            id: "q1",
            userId: "user-1",
            sourceId: "source-1",
            category: "카테고리",
            text: "재생성된 질문 텍스트입니다.",
            origin: "ai",
            createdAt: "2026-08-10T09:00:00+09:00",
          },
        }),
      );
      render(<EmptyQuestionState />);
      const user = userEvent.setup();

      // When
      await user.click(retryButton());

      // Then
      expect(await screen.findByText("재생성된 질문 텍스트입니다.")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
    });
  });

  describe("엣지 케이스", () => {
    it("생성이 404 source_not_found로 실패하면 해당 message가 표시되고 '다시 시도' 버튼이 다시 나타나 재시도할 수 있다", async () => {
      // Given
      fetchMock.mockResolvedValue(
        jsonResponse(404, { error: "source_not_found", message: "이력서를 찾을 수 없습니다." }),
      );
      render(<EmptyQuestionState />);
      const user = userEvent.setup();

      // When
      await user.click(retryButton());

      // Then
      expect(await screen.findByText("이력서를 찾을 수 없습니다.")).toBeInTheDocument();
      const retry = screen.getByRole("button", { name: "다시 시도" });
      expect(retry).not.toBeDisabled();

      // And: 재시도 가능
      fetchMock.mockClear();
      fetchMock.mockReturnValue(pendingForever());
      await user.click(retry);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("에러 케이스", () => {
    it("생성 요청 중 서버가 401을 반환하면 router.replace('/gate?reason=expired&next=%2Ftoday')로 즉시 리다이렉트된다", async () => {
      // Given
      fetchMock.mockResolvedValue(
        jsonResponse(401, { error: "unauthorized", message: "인증이 만료되었습니다." }),
      );
      render(<EmptyQuestionState />);
      const user = userEvent.setup();

      // When
      await user.click(retryButton());

      // Then
      await vi.waitFor(() =>
        expect(routerReplaceMock).toHaveBeenCalledWith("/gate?reason=expired&next=%2Ftoday"),
      );
    });

    it("생성 요청 중 네트워크가 단절되면 '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'가 표시되고 '다시 시도' 버튼이 유지된다", async () => {
      // Given
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      render(<EmptyQuestionState />);
      const user = userEvent.setup();

      // When
      await user.click(retryButton());

      // Then
      expect(
        await screen.findByText("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "다시 시도" })).not.toBeDisabled();
    });
  });
});

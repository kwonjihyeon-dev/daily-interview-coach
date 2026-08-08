import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GateForm } from "./GateForm";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md "게이트 폼(GateForm)" 절.
 *
 * `reason` prop에 따른 배너 렌더링은 부모인 게이트 페이지(Server Component)의 책임이므로
 * (스펙 "게이트 페이지" 절 참고) 이 파일에서는 다루지 않는다 — `page.test.tsx`에서 검증한다.
 * 여기서는 GateForm 자체의 제출/에러표시/재시도/중복제출 방지만 검증한다.
 */

const routerReplaceMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}));

const fetchMock = vi.hoisted(() => vi.fn());

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("GateForm", () => {
  describe("정상 시나리오", () => {
    it("이메일을 입력하고 제출하면 /api/gate/verify를 호출하고, 성공 시 nextPath로 이동한다", async () => {
      // Given
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
      render(<GateForm nextPath="/history" />);

      // When
      await user.type(screen.getByRole("textbox", { name: "이메일" }), "user@example.com");
      await user.click(screen.getByRole("button", { name: "제출" }));

      // Then
      await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/history"));
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/gate/verify",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "user@example.com" }),
        }),
      );
    });
  });

  describe("엣지 케이스", () => {
    it("제출 중(pending)에는 제출 버튼이 비활성화된다", async () => {
      // Given: fetch가 즉시 resolve되지 않도록 제어
      const user = userEvent.setup();
      let resolveFetch: (value: unknown) => void = () => undefined;
      fetchMock.mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      );
      render(<GateForm nextPath="/" />);
      const submitButton = screen.getByRole("button", { name: "제출" });

      // When
      await user.type(screen.getByRole("textbox", { name: "이메일" }), "user@example.com");
      await user.click(submitButton);

      // Then
      await waitFor(() => expect(submitButton).toBeDisabled());

      // cleanup: 대기 중인 fetch를 마무리한다
      resolveFetch(jsonResponse(200, { ok: true }));
    });

    it("실패 후 재시도 횟수 제한 없이 즉시 다시 제출할 수 있다", async () => {
      // Given: 첫 시도는 형식 오류로 실패, 두 번째 시도는 성공
      const user = userEvent.setup();
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(400, {
            error: "invalid_email_format",
            message: "올바른 이메일 형식이 아닙니다.",
          }),
        )
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
      render(<GateForm nextPath="/" />);
      const input = screen.getByRole("textbox", { name: "이메일" });
      const submitButton = screen.getByRole("button", { name: "제출" });

      // When: 첫 제출(실패)
      await user.type(input, "not-an-email");
      await user.click(submitButton);
      await screen.findByText("올바른 이메일 형식이 아닙니다.");

      // Then: 입력 필드는 편집 가능한 상태로 유지된다
      expect(input).not.toBeDisabled();
      expect(submitButton).not.toBeDisabled();

      // When: 즉시 재입력 후 재제출(성공) — 잠금/쿨다운 없음
      await user.clear(input);
      await user.type(input, "user@example.com");
      await user.click(submitButton);

      // Then
      await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/"));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("에러 케이스", () => {
    it("서버가 error/message를 반환하면 폼 아래에 그 메시지를 그대로 표시한다", async () => {
      // Given
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(
        jsonResponse(401, {
          error: "email_not_found",
          message: "등록되지 않은 이메일입니다. 접근 권한이 있는 이메일인지 확인해주세요.",
        }),
      );
      render(<GateForm nextPath="/" />);

      // When
      await user.type(screen.getByRole("textbox", { name: "이메일" }), "nobody@example.com");
      await user.click(screen.getByRole("button", { name: "제출" }));

      // Then
      expect(
        await screen.findByText(
          "등록되지 않은 이메일입니다. 접근 권한이 있는 이메일인지 확인해주세요.",
        ),
      ).toBeInTheDocument();
      expect(routerReplaceMock).not.toHaveBeenCalled();
    });

    it("업스트림 장애(502 upstream_unreachable) 시 안내 메시지를 표시한다", async () => {
      // Given
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(
        jsonResponse(502, {
          error: "upstream_unreachable",
          message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        }),
      );
      render(<GateForm nextPath="/" />);

      // When
      await user.type(screen.getByRole("textbox", { name: "이메일" }), "user@example.com");
      await user.click(screen.getByRole("button", { name: "제출" }));

      // Then
      expect(
        await screen.findByText("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."),
      ).toBeInTheDocument();
    });
  });
});

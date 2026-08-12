import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GateForm } from "./GateForm";

/**
 * 대상 스펙: .claude/artifacts/spec/클라이언트-데이터-계층-전환_spec.md "설계 판단 1" +
 * Acceptance Criteria A.
 *
 * v2(이메일-방문자-게이트_spec.md)에서 브라우저가 `fetch`로 apps/api의 `/api/sessions`를
 * `credentials:"include"`로 직접 호출하던 것이, 이번 전환으로 Server Action
 * (`./actions`의 `createVisitorSession`)을 호출하는 것으로 바뀌었다. `createVisitorSession`
 * 내부에서 일어나는 apiPost 호출·Set-Cookie 파싱·쿠키 적용(`applySetCookieHeaders`)은
 * 이 컴포넌트의 관심사가 아니므로(스코프 결정 — actions.ts 자체는 별도 유닛 테스트를 만들지
 * 않음), 이 파일은 `createVisitorSession`을 모듈째로 모킹하고 GateForm이 그 반환값의
 * `kind`에 따라 올바르게 분기하는지만 검증한다. 그래서 Set-Cookie 파싱 관련 상세 계약은
 * `apps/web/src/lib/setCookieForwarding.test.ts`가 별도로 담당한다.
 *
 * `reason` prop에 따른 배너 렌더링은 부모인 게이트 페이지(Server Component)의 책임이므로
 * (스펙 "게이트 페이지" 절 참고) 이 파일에서는 다루지 않는다 — `page.test.tsx`에서 검증한다.
 */

const routerReplaceMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}));

const createVisitorSessionMock = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  createVisitorSession: createVisitorSessionMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GateForm", () => {
  describe("정상 시나리오", () => {
    it("이메일을 입력하고 제출하면 createVisitorSession(email)이 호출되고, kind:'ok'이면 nextPath로 이동한다", async () => {
      // Given
      const user = userEvent.setup();
      createVisitorSessionMock.mockResolvedValue({ kind: "ok" });
      render(<GateForm nextPath="/history" />);

      // When
      await user.type(screen.getByRole("textbox", { name: "이메일" }), "user@example.com");
      await user.click(screen.getByRole("button", { name: "제출" }));

      // Then
      expect(createVisitorSessionMock).toHaveBeenCalledWith("user@example.com");
      await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/history"));
    });
  });

  describe("엣지 케이스", () => {
    it("제출 중(pending)에는 제출 버튼이 비활성화된다", async () => {
      // Given: createVisitorSession이 즉시 resolve되지 않도록 제어
      const user = userEvent.setup();
      let resolveAction: (value: unknown) => void = () => undefined;
      createVisitorSessionMock.mockReturnValue(
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
      );
      render(<GateForm nextPath="/" />);
      const submitButton = screen.getByRole("button", { name: "제출" });

      // When
      await user.type(screen.getByRole("textbox", { name: "이메일" }), "user@example.com");
      await user.click(submitButton);

      // Then
      await waitFor(() => expect(submitButton).toBeDisabled());

      // cleanup: 대기 중인 action을 마무리한다
      resolveAction({ kind: "ok" });
    });

    it("실패 후 재시도 횟수 제한 없이 즉시 다시 제출할 수 있다", async () => {
      // Given: 첫 시도는 형식 오류로 실패, 두 번째 시도는 성공
      const user = userEvent.setup();
      createVisitorSessionMock
        .mockResolvedValueOnce({ kind: "failed", message: "올바른 이메일 형식이 아닙니다." })
        .mockResolvedValueOnce({ kind: "ok" });
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
      expect(createVisitorSessionMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("에러 케이스", () => {
    it("createVisitorSession이 {kind:'failed', message}를 반환하면 폼 아래에 그 메시지를 그대로 표시하고, router.replace는 호출되지 않는다", async () => {
      // Given
      const user = userEvent.setup();
      createVisitorSessionMock.mockResolvedValue({
        kind: "failed",
        message: "등록되지 않은 이메일입니다. 접근 권한이 있는 이메일인지 확인해주세요.",
      });
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

    it("createVisitorSession 호출 자체가 프레임워크 레벨에서 reject되면(액션 ID 불일치 등) 호출부의 catch가 일시적 오류 메시지를 표시한다", async () => {
      // Given
      const user = userEvent.setup();
      createVisitorSessionMock.mockRejectedValue(new Error("failed to find Server Action"));
      render(<GateForm nextPath="/" />);

      // When
      await user.type(screen.getByRole("textbox", { name: "이메일" }), "user@example.com");
      await user.click(screen.getByRole("button", { name: "제출" }));

      // Then
      expect(createVisitorSessionMock).toHaveBeenCalledWith("user@example.com");
      expect(
        await screen.findByText("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."),
      ).toBeInTheDocument();
      expect(routerReplaceMock).not.toHaveBeenCalled();
    });
  });
});

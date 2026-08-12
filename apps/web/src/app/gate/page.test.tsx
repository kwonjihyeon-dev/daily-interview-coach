import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import GatePage from "./page";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md "게이트 페이지" 절.
 *
 * Server Component를 RTL로 직접 렌더링하기 어려우므로, `GatePage`를 일반 async 함수로
 * 직접 호출(`await GatePage({ searchParams })`)해 반환값(JSX 또는 redirect 호출)을
 * 검증한다. `next/headers`(cookies)와 `next/navigation`(redirect)은 모킹하고,
 * 자식 Client Component `GateForm`은 props 전달 여부만 확인하기 위해 스텁으로 모킹한다
 * (GateForm 자체의 제출 동작은 `GateForm.test.tsx`에서 별도로 검증하므로 중복하지 않는다).
 */

const cookieStoreMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: () => cookieStoreMock,
}));

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("./GateForm", () => ({
  GateForm: (props: { nextPath: string; reason?: string }) => (
    <div
      data-testid="gate-form-stub"
      data-next-path={props.nextPath}
      data-reason={props.reason ?? ""}
    />
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GatePage", () => {
  describe("정상 시나리오", () => {
    it("이미 유효한 형식의 쿠키가 있으면 GateForm을 그리지 않고 next(안전한 경로)로 리다이렉트한다", async () => {
      // Given
      cookieStoreMock.get.mockReturnValue({ value: "user@example.com" });

      // When
      await GatePage({ searchParams: Promise.resolve({ next: "/history" }) });

      // Then
      expect(redirectMock).toHaveBeenCalledWith("/history");
    });

    it("next 파라미터가 없으면 유효한 쿠키 보유 시 '/'로 리다이렉트한다", async () => {
      // Given
      cookieStoreMock.get.mockReturnValue({ value: "user@example.com" });

      // When
      await GatePage({ searchParams: Promise.resolve({}) });

      // Then
      expect(redirectMock).toHaveBeenCalledWith("/");
    });
  });

  describe("엣지 케이스", () => {
    it("유효한 쿠키를 갖고 있어도 next가 안전하지 않으면(절대 URL) '/'로 리다이렉트한다", async () => {
      // Given
      cookieStoreMock.get.mockReturnValue({ value: "user@example.com" });

      // When
      await GatePage({ searchParams: Promise.resolve({ next: "https://evil.com" }) });

      // Then
      expect(redirectMock).toHaveBeenCalledWith("/");
    });

    it("유효한 쿠키를 갖고 있어도 next가 '//'로 시작하면(프로토콜 상대 URL) '/'로 리다이렉트한다", async () => {
      // Given
      cookieStoreMock.get.mockReturnValue({ value: "user@example.com" });

      // When
      await GatePage({ searchParams: Promise.resolve({ next: "//evil.com" }) });

      // Then
      expect(redirectMock).toHaveBeenCalledWith("/");
    });

    it("쿠키가 없으면 리다이렉트하지 않고 GateForm에 정제된 nextPath를 전달해 렌더링한다", async () => {
      // Given
      cookieStoreMock.get.mockReturnValue(undefined);

      // When
      const jsx = await GatePage({ searchParams: Promise.resolve({ next: "/history" }) });
      render(jsx as ReactElement);

      // Then
      expect(redirectMock).not.toHaveBeenCalled();
      expect(screen.getByTestId("gate-form-stub")).toHaveAttribute("data-next-path", "/history");
    });

    it("쿠키 값이 이메일 형식이 아니면(무효) 리다이렉트하지 않고 GateForm을 렌더링한다", async () => {
      // Given
      cookieStoreMock.get.mockReturnValue({ value: "abc123" });

      // When
      const jsx = await GatePage({ searchParams: Promise.resolve({}) });
      render(jsx as ReactElement);

      // Then
      expect(redirectMock).not.toHaveBeenCalled();
      expect(screen.getByTestId("gate-form-stub")).toBeInTheDocument();
    });

    it("reason=expired이면 폼 위에 만료 안내 배너를 표시한다", async () => {
      // Given
      cookieStoreMock.get.mockReturnValue(undefined);

      // When
      const jsx = await GatePage({ searchParams: Promise.resolve({ reason: "expired" }) });
      render(jsx as ReactElement);

      // Then
      expect(
        screen.getByText("인증이 만료되었습니다. 이메일을 다시 입력해주세요."),
      ).toBeInTheDocument();
    });

    it("reason이 없으면 배너를 표시하지 않는다", async () => {
      // Given
      cookieStoreMock.get.mockReturnValue(undefined);

      // When
      const jsx = await GatePage({ searchParams: Promise.resolve({}) });
      render(jsx as ReactElement);

      // Then
      expect(
        screen.queryByText("인증이 만료되었습니다. 이메일을 다시 입력해주세요."),
      ).not.toBeInTheDocument();
    });
  });
});

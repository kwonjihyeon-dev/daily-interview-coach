import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GateForm } from "./GateForm";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md (v2) "게이트 폼(GateForm, 변경 — 직접 호출)" 절.
 *
 * v1의 Next.js Route Handler(`/api/gate/verify`) 프록시가 폐기되고, 브라우저가
 * `${NEXT_PUBLIC_API_BASE_URL}/api/sessions`(구 `/api/auth/verify-email` — 아키텍처 결정
 * 사항 #8로 RESTful하게 재명명됨, 성공 상태코드도 200→201)을 `credentials: "include"`로
 * 직접 호출한다(apps/api가 쿠키를 발급하므로 브라우저가 이를 저장하려면 필수). `GateForm`은
 * `response.ok`만으로 성공/실패를 판단하므로 정확한 성공 상태코드(200 vs 201) 자체는 이
 * 컴포넌트의 관심사가 아니지만, 이 파일의 모킹된 성공 응답은 실제 계약과 맞춰 201로 통일한다.
 *
 * `reason` prop에 따른 배너 렌더링은 부모인 게이트 페이지(Server Component)의 책임이므로
 * (스펙 "게이트 페이지" 절 참고) 이 파일에서는 다루지 않는다 — `page.test.tsx`에서 검증한다.
 * 여기서는 GateForm 자체의 제출/에러표시/재시도/중복제출 방지만 검증한다.
 *
 * v1의 502 upstream_unreachable 개념은 사라진다(Route Handler가 없어 상태코드를 만들어낼
 * 주체가 없음) — 네트워크 단절/CORS 차단/JSON 파싱 실패를 모두 하나의 try/catch로 묶어
 * 동일한 안내 문구를 표시한다.
 */

const routerReplaceMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}));

const fetchMock = vi.hoisted(() => vi.fn());

const API_BASE_URL = "http://localhost:3001";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", API_BASE_URL);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("GateForm", () => {
  describe("정상 시나리오", () => {
    it("이메일을 입력하고 제출하면 apps/api의 /api/sessions을 credentials:include로 직접 호출하고, 성공 시 nextPath로 이동한다", async () => {
      // Given
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(jsonResponse(201, { verified: true }));
      render(<GateForm nextPath="/history" />);

      // When
      await user.type(screen.getByRole("textbox", { name: "이메일" }), "user@example.com");
      await user.click(screen.getByRole("button", { name: "제출" }));

      // Then
      await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/history"));
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_BASE_URL}/api/sessions`,
        expect.objectContaining({
          method: "POST",
          credentials: "include",
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
      resolveFetch(jsonResponse(201, { verified: true }));
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
        .mockResolvedValueOnce(jsonResponse(201, { verified: true }));
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
    it("apps/api가 error/message를 반환하면 폼 아래에 그 메시지를 그대로 표시한다", async () => {
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

    it("apps/api 자체가 응답하지 않으면(네트워크 단절) fetch가 예외를 던지고 안내 메시지를 표시한다 (v1의 502 upstream_unreachable 상태코드는 더 이상 존재하지 않는다)", async () => {
      // Given
      const user = userEvent.setup();
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      render(<GateForm nextPath="/" />);

      // When
      await user.type(screen.getByRole("textbox", { name: "이메일" }), "user@example.com");
      await user.click(screen.getByRole("button", { name: "제출" }));

      // Then
      expect(
        await screen.findByText("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."),
      ).toBeInTheDocument();
      expect(routerReplaceMock).not.toHaveBeenCalled();
    });

    it("CORS 정책 위반으로 브라우저가 fetch를 예외로 처리해도 네트워크 단절과 동일한 안내 메시지를 표시한다(브라우저가 두 경우를 구분해 노출하지 않으므로 코드도 구분하지 않는다)", async () => {
      // Given: 브라우저는 CORS 실패를 TypeError로만 노출하며 원인을 알려주지 않는다
      const user = userEvent.setup();
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      render(<GateForm nextPath="/" />);

      // When
      await user.type(screen.getByRole("textbox", { name: "이메일" }), "user@example.com");
      await user.click(screen.getByRole("button", { name: "제출" }));

      // Then
      expect(
        await screen.findByText("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."),
      ).toBeInTheDocument();
    });

    it("응답을 JSON으로 파싱할 수 없으면(deserialize 실패) 네트워크 단절과 동일한 안내 메시지를 표시한다(fetch와 json() 파싱을 하나의 try/catch로 묶어 처리)", async () => {
      // Given
      const user = userEvent.setup();
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      });
      render(<GateForm nextPath="/" />);

      // When
      await user.type(screen.getByRole("textbox", { name: "이메일" }), "user@example.com");
      await user.click(screen.getByRole("button", { name: "제출" }));

      // Then
      expect(
        await screen.findByText("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."),
      ).toBeInTheDocument();
      expect(routerReplaceMock).not.toHaveBeenCalled();
    });
  });
});

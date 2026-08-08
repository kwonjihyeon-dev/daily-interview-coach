import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VISITOR_COOKIE_MAX_AGE_SECONDS,
  VISITOR_COOKIE_NAME,
  buildVisitorCookieOptions,
  isValidVisitorEmailCookieValue,
} from "./visitorCookie";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md "쿠키 명세" 절.
 *
 * `middleware.ts`(형식 검사)와 `app/api/gate/verify/route.ts`(쿠키 발급 옵션)가 함께
 * 참조하는 공용 상수/순수 함수를 이 모듈에서 검증한다.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("VISITOR_COOKIE_NAME / VISITOR_COOKIE_MAX_AGE_SECONDS", () => {
  it("쿠키 이름은 dic_visitor_email, maxAge는 15552000초(180일)이다", () => {
    expect(VISITOR_COOKIE_NAME).toBe("dic_visitor_email");
    expect(VISITOR_COOKIE_MAX_AGE_SECONDS).toBe(15552000);
  });
});

describe("isValidVisitorEmailCookieValue", () => {
  describe("정상 시나리오", () => {
    it("이메일 형식의 값이면 true를 반환한다", () => {
      expect(isValidVisitorEmailCookieValue("user@example.com")).toBe(true);
    });
  });

  describe("엣지 케이스", () => {
    it("값이 없으면(undefined) false를 반환한다", () => {
      expect(isValidVisitorEmailCookieValue(undefined)).toBe(false);
    });

    it("값이 null이면 false를 반환한다", () => {
      expect(isValidVisitorEmailCookieValue(null)).toBe(false);
    });

    it("빈 문자열이면 false를 반환한다", () => {
      expect(isValidVisitorEmailCookieValue("")).toBe(false);
    });

    it("이메일 형식이 아니면(@ 없음) false를 반환한다", () => {
      expect(isValidVisitorEmailCookieValue("abc123")).toBe(false);
    });

    it("앞뒤 공백이 포함된 값은 false를 반환한다(정규화되지 않은 값은 무효)", () => {
      expect(isValidVisitorEmailCookieValue(" user@example.com ")).toBe(false);
    });

    it("정확히 254자인 이메일은 true를 반환한다(경계값)", () => {
      const local = "a".repeat(254 - "@a.co".length);
      const email = `${local}@a.co`;
      expect(email.length).toBe(254);
      expect(isValidVisitorEmailCookieValue(email)).toBe(true);
    });

    it("255자를 초과하는 이메일은 false를 반환한다(경계값 초과)", () => {
      const local = "a".repeat(256 - "@a.co".length);
      const email = `${local}@a.co`;
      expect(email.length).toBe(256);
      expect(isValidVisitorEmailCookieValue(email)).toBe(false);
    });
  });
});

describe("buildVisitorCookieOptions", () => {
  it("NODE_ENV=production이면 secure: true를 반환한다", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(buildVisitorCookieOptions()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 15552000,
    });
  });

  it("NODE_ENV가 production이 아니면(로컬 개발) secure: false를 반환한다", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(buildVisitorCookieOptions()).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 15552000,
    });
  });
});

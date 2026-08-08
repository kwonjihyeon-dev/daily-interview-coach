import { describe, expect, it } from "vitest";
import { VISITOR_COOKIE_NAME, isValidVisitorEmailCookieValue } from "./visitorCookie";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md (v2) "쿠키 명세" 절.
 *
 * v2 재설계로 쿠키 발급 주체가 `apps/web`(Route Handler)에서 `apps/api`로 이동했다.
 * 이에 따라 `buildVisitorCookieOptions`/`VisitorCookieOptions`/
 * `VISITOR_COOKIE_MAX_AGE_SECONDS`는 이 모듈에서 완전히 제거된다(발급 옵션은 신규
 * `apps/api/src/lib/visitorCookie.ts`가 전담 — 그 파일의 테스트는 developer 단계에서
 * 함께 작성될 구현에 맞춰 별도로 다룬다).
 *
 * `apps/web`은 `middleware.ts`(쿠키 형식 검사)와 `gate/page.tsx`가 함께 참조하는
 * `VISITOR_COOKIE_NAME`/`isValidVisitorEmailCookieValue`만 유지한다 — 이 두 export는
 * v1과 동작 변화가 없다.
 */

describe("VISITOR_COOKIE_NAME", () => {
  it("쿠키 이름은 dic_visitor_email이다", () => {
    expect(VISITOR_COOKIE_NAME).toBe("dic_visitor_email");
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

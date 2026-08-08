import { describe, expect, it } from "vitest";
import { sanitizeNextPath } from "./sanitizeNextPath";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md
 * "게이트 페이지" 절의 오픈 리다이렉트 방지 규칙:
 *   1. 정확히 "/"로 시작
 *   2. "//"로 시작하지 않음 (프로토콜 상대 URL 차단)
 *   3. "://"를 포함하지 않음 (절대 URL 차단)
 * 하나라도 위반하면 "/"로 대체한다.
 */
describe("sanitizeNextPath", () => {
  describe("정상 시나리오", () => {
    it("'/'로 시작하는 경로는 그대로 반환한다", () => {
      expect(sanitizeNextPath("/history")).toBe("/history");
    });

    it("쿼리스트링이 포함된 경로도 그대로 보존한다", () => {
      expect(sanitizeNextPath("/history?filter=answered")).toBe("/history?filter=answered");
    });
  });

  describe("엣지 케이스", () => {
    it("값이 undefined이면 '/'를 반환한다", () => {
      expect(sanitizeNextPath(undefined)).toBe("/");
    });

    it("값이 null이면 '/'를 반환한다", () => {
      expect(sanitizeNextPath(null)).toBe("/");
    });

    it("빈 문자열이면 '/'를 반환한다", () => {
      expect(sanitizeNextPath("")).toBe("/");
    });

    it("'/'로 시작하지 않는 값(예: 'evil.com')이면 '/'를 반환한다", () => {
      expect(sanitizeNextPath("evil.com")).toBe("/");
    });

    it("'//'로 시작하는 프로토콜 상대 URL이면 '/'를 반환한다", () => {
      expect(sanitizeNextPath("//evil.com")).toBe("/");
    });

    it("'://'를 포함하는 절대 URL(https://evil.com)이면 '/'를 반환한다", () => {
      expect(sanitizeNextPath("https://evil.com")).toBe("/");
    });

    it("'/'로 시작하더라도 중간에 '://'를 포함하면 '/'를 반환한다", () => {
      expect(sanitizeNextPath("/redirect?to=https://evil.com")).toBe("/");
    });
  });
});

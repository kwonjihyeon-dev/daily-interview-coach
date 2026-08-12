// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md
 * "apps/web/src/middleware.ts"(Next 16에서 `proxy.ts`로 이름 변경) 절 + Acceptance Criteria.
 *
 * `NextRequest`/`NextResponse`가 Web 표준 Request/Response 기반이라 jsdom 환경에서
 * 불필요한 충돌을 피하기 위해 이 파일은 `node` 환경으로 강제한다(@vitest-environment).
 *
 * DB 재조회는 미들웨어 책임이 아니므로(Edge에서 매 네비게이션마다 DB 호출 시 지연 발생,
 * 스펙 명시) 여기서는 오직 "쿠키 형식 검증 + 리다이렉트/통과" 로직만 검증한다.
 */

function buildRequest(url: string, cookieHeader?: string): NextRequest {
  return new NextRequest(url, cookieHeader ? { headers: { cookie: cookieHeader } } : undefined);
}

describe("proxy", () => {
  describe("정상 시나리오", () => {
    it("쿠키가 없으면 '/gate?next=%2F'로 307 리다이렉트한다", () => {
      // Given: dic_visitor_email 쿠키 없이 '/'에 접근
      const req = buildRequest("http://localhost:3000/");

      // When
      const res = proxy(req);

      // Then
      expect(res.status).toBe(307);
      const location = new URL(res.headers.get("location")!);
      expect(location.pathname).toBe("/gate");
      expect(location.searchParams.get("next")).toBe("/");
    });

    it("쿼리스트링이 있는 경로에서 쿠키가 없으면 쿼리스트링까지 보존해 next로 전달한다", () => {
      // Given
      const req = buildRequest("http://localhost:3000/history?filter=answered");

      // When
      const res = proxy(req);

      // Then
      expect(res.status).toBe(307);
      const location = new URL(res.headers.get("location")!);
      expect(location.pathname).toBe("/gate");
      expect(location.searchParams.get("next")).toBe("/history?filter=answered");
    });

    it("형식이 유효한 dic_visitor_email 쿠키가 있으면 리다이렉트하지 않고 통과시킨다", () => {
      // Given
      const req = buildRequest(
        "http://localhost:3000/",
        "dic_visitor_email=user%40example.com",
      );

      // When
      const res = proxy(req);

      // Then: NextResponse.next()는 x-middleware-next 헤더를 갖는다
      expect(res.headers.get("x-middleware-next")).toBe("1");
      expect(res.status).not.toBe(307);
    });
  });

  describe("엣지 케이스", () => {
    it("쿠키 값이 이메일 형식이 아니면(변조 등) '/gate?next=...'로 리다이렉트한다", () => {
      // Given: 값이 "abc123"으로 변조된 쿠키
      const req = buildRequest("http://localhost:3000/", "dic_visitor_email=abc123");

      // When
      const res = proxy(req);

      // Then
      expect(res.status).toBe(307);
      const location = new URL(res.headers.get("location")!);
      expect(location.pathname).toBe("/gate");
      expect(location.searchParams.get("next")).toBe("/");
    });

    it("쿠키 값이 255자를 초과하는 이메일 형식이면 무효로 간주해 리다이렉트한다", () => {
      // Given
      const longEmail = `${"a".repeat(252)}@a.co`; // 256자
      expect(longEmail.length).toBeGreaterThan(254);
      const req = buildRequest(
        "http://localhost:3000/",
        `dic_visitor_email=${encodeURIComponent(longEmail)}`,
      );

      // When
      const res = proxy(req);

      // Then
      expect(res.status).toBe(307);
    });

    it("쿠키가 폐기(만료)되어 요청에 실려오지 않으면 '쿠키 없음'과 동일하게 처리해 리다이렉트한다", () => {
      // Given: maxAge 만료로 브라우저가 쿠키를 자동 폐기한 상태(=쿠키 헤더 자체가 없음)
      const req = buildRequest("http://localhost:3000/history");

      // When
      const res = proxy(req);

      // Then: 별도 로그아웃 로직 없이 "쿠키 없음"과 동일한 리다이렉트가 발생한다
      expect(res.status).toBe(307);
      const location = new URL(res.headers.get("location")!);
      expect(location.searchParams.get("next")).toBe("/history");
    });
  });
});

describe("config.matcher", () => {
  it("/gate, /_next, favicon.ico, manifest.json, sw.js, icons 관련 경로를 매처에서 제외한다", () => {
    // 정확한 정규식 문법은 구현 선택에 맡기고, 제외 대상 키워드가 매처 설정에
    // 반영되어 있는지만 가벼운 스모크 테스트로 확인한다(과도한 E2E 매칭 로직은 지양).
    const matcherString = JSON.stringify(config.matcher);
    expect(matcherString).toContain("gate");
    expect(matcherString).toContain("_next");
    expect(matcherString).toContain("favicon.ico");
    expect(matcherString).toContain("manifest.json");
    expect(matcherString).toContain("sw.js");
    expect(matcherString).toContain("icons");
  });
});

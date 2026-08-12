import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 대상 스펙: .claude/artifacts/spec/클라이언트-데이터-계층-전환_spec.md "설계 판단 1" +
 * Acceptance Criteria D.
 *
 * 이 파일은 이번 전환에서 유일하게 새로 생기고, 전환이 끝난 뒤에도 계속 살아남는 로직
 * (`setCookieForwarding.ts`)의 단위 테스트다. `apps/api`가 발급한 `Set-Cookie` 헤더
 * 문자열을 파싱해 Next `cookies().set()` 호출로 그대로 전달하는 것이 유일한 책임이다.
 *
 * ## 이 로직이 틀렸을 때의 증상 (왜 이렇게 촘촘하게 테스트하는가)
 *
 * `parseSetCookieHeader`/`applySetCookieHeaders`가 조금이라도 잘못 파싱하면 —
 * 예를 들어 `Max-Age`를 ms로 잘못 변환하거나, 쿠키 값을 디코딩하지 못하거나,
 * `applySetCookieHeaders`가 빈 배열일 때 아무 것도 안 해야 하는데 예외를 던지면 —
 * `createVisitorSession` Server Action이 성공(201)했음에도 브라우저에 쿠키가
 * 저장되지 않는다. 그 결과 사용자는 게이트를 통과한 것처럼 보이지만, 다음 네비게이션에서
 * `proxy.ts`(미들웨어)가 쿠키를 발견하지 못해 다시 `/gate`로 되돌려보낸다 — 즉
 * "게이트 통과 → 쿠키 없음 → /gate로 재리다이렉트"가 반복되는 **무한 리다이렉트**가
 * 발생한다. 이 버그는 겉보기에 "로그인이 안 된다"로만 보여 원인을 찾기 어렵기 때문에,
 * 특히 단위(ms vs 초) 트랩과 URL 디코딩 트랩을 이 파일에서 반드시 못박아 둔다.
 */

const cookieStoreSetMock = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({
  // 실제 next/headers의 cookies()는 Promise를 반환하지만, 호출부는 항상 `await cookies()`로
  // 사용하므로 동기 함수로 모킹해도 await가 그대로 값을 통과시켜 동일하게 동작한다
  // (apps/web/src/app/gate/page.test.tsx의 cookieStoreMock 패턴과 동일).
  cookies: () => ({ set: cookieStoreSetMock }),
}));

import { applySetCookieHeaders, parseSetCookieHeader } from "./setCookieForwarding";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("parseSetCookieHeader", () => {
  describe("정상 시나리오", () => {
    it("apps/api가 실제로 내려주는 형태(Max-Age/Path/HttpOnly/SameSite)를 정확히 파싱한다", () => {
      // Given
      const rawSetCookie =
        "dic_visitor_email=user%40example.com; Max-Age=15552000; Path=/; HttpOnly; SameSite=Lax";

      // When
      const result = parseSetCookieHeader(rawSetCookie);

      // Then
      expect(result).toEqual({
        name: "dic_visitor_email",
        value: "user@example.com",
        options: {
          maxAge: 15552000,
          path: "/",
          httpOnly: true,
          sameSite: "lax",
        },
      });
    });

    it("Secure 속성이 추가로 포함되면 options.secure===true가 포함된다", () => {
      // Given
      const rawSetCookie =
        "dic_visitor_email=user%40example.com; Max-Age=15552000; Path=/; HttpOnly; Secure; SameSite=Lax";

      // When
      const result = parseSetCookieHeader(rawSetCookie);

      // Then
      expect(result.options.secure).toBe(true);
    });
  });

  describe("단위 변환 트랩 — Max-Age는 초 단위로, 변환 없이 그대로 반영되어야 한다", () => {
    it("Max-Age=15552000(초, 180일)을 파싱하면 maxAge는 정확히 15552000이어야 한다(×1000/÷1000 금지)", () => {
      // Given: Express가 헤더에 실제로 쓰는 Max-Age는 이미 초 단위이고, Next의
      // cookies().set()의 maxAge 옵션도 초 단위다(apps/web/node_modules/next/dist/docs/
      // 01-app/03-api-reference/04-functions/cookies.md:52 "Sets the cookie's lifespan
      // in seconds"). 이 지점에서 단위 변환을 넣으면 쿠키 수명이 1000배 틀어진다.
      const rawSetCookie = "dic_visitor_email=user%40example.com; Max-Age=15552000";

      // When
      const result = parseSetCookieHeader(rawSetCookie);

      // Then: 15552000000(×1000, ms로 착각)도 15552(÷1000, 잘못된 역변환)도 아닌
      // 정확히 15552000이어야 한다.
      expect(result.options.maxAge).toBe(15552000);
      expect(result.options.maxAge).not.toBe(15552000000);
      expect(result.options.maxAge).not.toBe(15552);
    });
  });

  describe("URL 디코딩 트랩", () => {
    it("Express res.cookie가 인코딩한 값(user%40example.com)을 user@example.com으로 디코드한다", () => {
      // Given
      const rawSetCookie = "dic_visitor_email=user%40example.com; Path=/";

      // When
      const result = parseSetCookieHeader(rawSetCookie);

      // Then
      expect(result.value).toBe("user@example.com");
    });

    it("디코딩에 실패하는 값(불완전한 percent-encoding)이면 원본 문자열을 그대로 사용한다(방어적)", () => {
      // Given: "a%"는 decodeURIComponent가 URIError를 던지는 불완전한 percent-encoding이다.
      const rawSetCookie = "dic_visitor_email=a%; Path=/";

      // When
      const result = parseSetCookieHeader(rawSetCookie);

      // Then
      expect(result.value).toBe("a%");
    });
  });

  describe("엣지 케이스", () => {
    it("Max-Age 속성이 없으면 options.maxAge는 undefined다(세션 쿠키)", () => {
      // Given
      const rawSetCookie = "dic_visitor_email=user%40example.com; Path=/; HttpOnly";

      // When
      const result = parseSetCookieHeader(rawSetCookie);

      // Then
      expect(result.options.maxAge).toBeUndefined();
    });

    it("Expires에 쉼표가 포함된 날짜 문자열이 있어도 세미콜론 분리 파싱과 다른 속성 파싱에 영향을 주지 않고, Expires 자체는 결과에 포함되지 않는다", () => {
      // Given
      const rawSetCookie =
        "dic_visitor_email=user%40example.com; Max-Age=15552000; Path=/; " +
        "Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; SameSite=Lax";

      // When
      const result = parseSetCookieHeader(rawSetCookie);

      // Then: Max-Age/Path/HttpOnly/SameSite는 Expires의 쉼표에 영향받지 않고 정상 파싱된다.
      expect(result).toEqual({
        name: "dic_visitor_email",
        value: "user@example.com",
        options: {
          maxAge: 15552000,
          path: "/",
          httpOnly: true,
          sameSite: "lax",
        },
      });
      // And: options 어디에도 expires 관련 키가 없다.
      expect(result.options).not.toHaveProperty("expires");
    });

    it("속성 키는 대소문자를 구분하지 않고 인식한다(소문자 max-age/path/httponly/secure/samesite)", () => {
      // Given
      const rawSetCookie =
        "dic_visitor_email=user%40example.com; max-age=3600; path=/foo; httponly; secure; samesite=strict";

      // When
      const result = parseSetCookieHeader(rawSetCookie);

      // Then
      expect(result.options).toEqual({
        maxAge: 3600,
        path: "/foo",
        httpOnly: true,
        secure: true,
        sameSite: "strict",
      });
    });

    it("SameSite 값이 lax/strict/none 중 하나가 아니면 무시한다(sameSite는 undefined로 남는다)", () => {
      // Given
      const rawSetCookie = "dic_visitor_email=user%40example.com; SameSite=Foo";

      // When
      const result = parseSetCookieHeader(rawSetCookie);

      // Then
      expect(result.options.sameSite).toBeUndefined();
    });

    it("세그먼트 앞뒤 공백은 trim되어 파싱에 영향을 주지 않는다", () => {
      // Given
      const rawSetCookie =
        "dic_visitor_email=user%40example.com ;  Max-Age=3600 ;  HttpOnly ";

      // When
      const result = parseSetCookieHeader(rawSetCookie);

      // Then
      expect(result.name).toBe("dic_visitor_email");
      expect(result.value).toBe("user@example.com");
      expect(result.options.maxAge).toBe(3600);
      expect(result.options.httpOnly).toBe(true);
    });
  });
});

describe("applySetCookieHeaders", () => {
  describe("정상 시나리오", () => {
    it("단일 Set-Cookie 헤더를 파싱해 cookies().set(name, value, options)을 1회 호출한다", async () => {
      // Given
      const rawSetCookie =
        "dic_visitor_email=user%40example.com; Max-Age=15552000; Path=/; HttpOnly; SameSite=Lax";

      // When
      await applySetCookieHeaders([rawSetCookie]);

      // Then
      expect(cookieStoreSetMock).toHaveBeenCalledTimes(1);
      expect(cookieStoreSetMock).toHaveBeenCalledWith("dic_visitor_email", "user@example.com", {
        maxAge: 15552000,
        path: "/",
        httpOnly: true,
        sameSite: "lax",
      });
    });

    it("여러 개의 Set-Cookie 헤더가 있으면 각 원소마다 순서대로 set()을 호출한다", async () => {
      // Given
      const rawHeaders = [
        "dic_visitor_email=user%40example.com; Max-Age=15552000; Path=/",
        "other_cookie=value2; Path=/",
      ];

      // When
      await applySetCookieHeaders(rawHeaders);

      // Then
      expect(cookieStoreSetMock).toHaveBeenCalledTimes(2);
      expect(cookieStoreSetMock).toHaveBeenNthCalledWith(1, "dic_visitor_email", "user@example.com", {
        maxAge: 15552000,
        path: "/",
      });
      expect(cookieStoreSetMock).toHaveBeenNthCalledWith(2, "other_cookie", "value2", {
        path: "/",
      });
    });
  });

  describe("에러 케이스", () => {
    it("빈 배열이면 cookies().set()은 한 번도 호출되지 않는다", async () => {
      // Given / When
      await applySetCookieHeaders([]);

      // Then
      expect(cookieStoreSetMock).not.toHaveBeenCalled();
    });
  });
});

import { cookies } from "next/headers";

/**
 * 대상 스펙: .claude/artifacts/spec/클라이언트-데이터-계층-전환_spec.md "설계 판단 1" 절.
 *
 * apps/api가 발급한 `Set-Cookie` 헤더 문자열을 파싱해 Next `cookies().set()` 호출로 그대로
 * 전달하는 것이 유일한 책임이다. 쿠키 정책(Max-Age/HttpOnly/SameSite 등)은 apps/api가
 * 단독 소유하며, 이 모듈은 그 정책을 재해석하지 않고 그대로 옮긴다.
 *
 * ## 이 로직이 틀렸을 때의 증상
 *
 * `parseSetCookieHeader`/`applySetCookieHeaders`가 조금이라도 잘못 파싱하면(예: `Max-Age`를
 * ms로 잘못 변환하거나, 쿠키 값을 디코딩하지 못하면) `createVisitorSession` Server Action이
 * 성공(201)했음에도 브라우저에 쿠키가 저장되지 않는다. 그 결과 사용자는 게이트를 통과한
 * 것처럼 보이지만, 다음 네비게이션에서 `proxy.ts`가 쿠키를 발견하지 못해 다시 `/gate`로
 * 되돌려보낸다 — "게이트 통과 → 쿠키 없음 → /gate로 재리다이렉트"가 반복되는 무한
 * 리다이렉트가 발생한다.
 *
 * **단위 주의**: `Max-Age`는 Express가 헤더에 실제로 쓸 때 이미 초 단위이고, Next
 * `cookies().set()`의 `maxAge` 옵션도 초 단위다(apps/web/node_modules/next/dist/docs/
 * 01-app/03-api-reference/04-functions/cookies.md: "Sets the cookie's lifespan in
 * seconds"). 이 지점에서 ms↔초 변환을 넣으면 쿠키 수명이 1000배 틀어진다 — 절대 변환하지
 * 않는다.
 */

export interface ParsedSetCookie {
  name: string;
  value: string;
  options: {
    path?: string;
    maxAge?: number; // 단위: 초 (Next의 cookies().set() 옵션과 동일 단위, 변환하지 않음)
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none";
  };
}

const VALID_SAME_SITE_VALUES = new Set(["lax", "strict", "none"]);

function decodeCookieValue(rawValue: string): string {
  try {
    return decodeURIComponent(rawValue);
  } catch {
    // 불완전한 percent-encoding(예: "a%")이면 디코딩을 시도하지 않고 원본을 그대로 쓴다.
    return rawValue;
  }
}

export function parseSetCookieHeader(rawSetCookie: string): ParsedSetCookie {
  const [nameValueSegment, ...attributeSegments] = rawSetCookie
    .split(";")
    .map((segment) => segment.trim());

  const equalsIndex = nameValueSegment.indexOf("=");
  const name = nameValueSegment.slice(0, equalsIndex);
  const value = decodeCookieValue(nameValueSegment.slice(equalsIndex + 1));

  const options: ParsedSetCookie["options"] = {};

  for (const attributeSegment of attributeSegments) {
    if (attributeSegment.length === 0) continue;

    const attributeEqualsIndex = attributeSegment.indexOf("=");
    const hasValue = attributeEqualsIndex !== -1;
    const key = (
      hasValue ? attributeSegment.slice(0, attributeEqualsIndex) : attributeSegment
    ).toLowerCase();
    const attributeValue = hasValue ? attributeSegment.slice(attributeEqualsIndex + 1) : undefined;

    switch (key) {
      case "max-age":
        if (attributeValue !== undefined) options.maxAge = Number(attributeValue);
        break;
      case "path":
        if (attributeValue !== undefined) options.path = attributeValue;
        break;
      case "httponly":
        options.httpOnly = true;
        break;
      case "secure":
        options.secure = true;
        break;
      case "samesite": {
        const loweredValue = attributeValue?.toLowerCase();
        if (loweredValue !== undefined && VALID_SAME_SITE_VALUES.has(loweredValue)) {
          options.sameSite = loweredValue as "lax" | "strict" | "none";
        }
        break;
      }
      default:
        // "expires" 등 그 외 속성은 무시한다(Max-Age가 있으면 우선하므로 별도 처리 불필요).
        break;
    }
  }

  return { name, value, options };
}

export async function applySetCookieHeaders(rawSetCookieHeaders: string[]): Promise<void> {
  if (rawSetCookieHeaders.length === 0) return;

  const cookieStore = await cookies();
  for (const rawSetCookie of rawSetCookieHeaders) {
    const { name, value, options } = parseSetCookieHeader(rawSetCookie);
    cookieStore.set(name, value, options);
  }
}

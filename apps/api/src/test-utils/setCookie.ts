/**
 * 테스트 전용 헬퍼(프로덕션 코드 아님).
 *
 * `Set-Cookie` 헤더를 검증해야 하는 테스트가 늘어날 때마다(예: `routes/auth.test.ts`의
 * 쿠키 발급 검증, 향후 로그아웃/쿠키 갱신 기능 등) 파싱 로직을 각 테스트 파일에 중복
 * 작성하면 한 곳에서만 고쳐서 다른 곳은 놓치는 실수가 생기기 쉽다. 이 파일에 한 번만
 * 작성해 모든 `*.test.ts`가 공유한다.
 *
 * 이 파일 자체는 `describe`/`it`을 포함하지 않으므로 vitest가 별도 테스트 파일로
 * 수집하지 않는다(파일명이 `*.test.ts`가 아님).
 */

export interface ParsedSetCookie {
  name: string;
  value: string;
  attributes: Record<string, string | true>;
}

/** 단일 `Set-Cookie` 헤더 문자열(예: "dic_visitor_email=a%40b.com; Path=/; HttpOnly")을 파싱한다. */
export function parseSetCookie(setCookieHeader: string): ParsedSetCookie {
  const [nameValue, ...attrParts] = setCookieHeader.split(";").map((part) => part.trim());
  const eqIndex = nameValue.indexOf("=");
  const name = nameValue.slice(0, eqIndex);
  const value = decodeURIComponent(nameValue.slice(eqIndex + 1));
  const attributes: Record<string, string | true> = {};
  for (const attrPart of attrParts) {
    const [key, val] = attrPart.split("=");
    attributes[key.toLowerCase()] = val ?? true;
  }
  return { name, value, attributes };
}

/**
 * supertest 응답에서 특정 이름의 `Set-Cookie` 헤더 문자열을 찾는다.
 * 여러 쿠키가 동시에 발급될 수 있으므로(`res.headers["set-cookie"]`가 배열) 이름으로 필터링한다.
 */
export function findSetCookie(
  res: { headers: Record<string, string | string[] | undefined> },
  cookieName: string,
): string | undefined {
  const setCookieHeader = res.headers["set-cookie"];
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [];
  return cookies.find((cookie) => cookie.startsWith(`${cookieName}=`));
}

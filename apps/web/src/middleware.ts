import { NextRequest, NextResponse } from "next/server";
import { VISITOR_COOKIE_NAME, isValidVisitorEmailCookieValue } from "./lib/visitorCookie";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md
 * "apps/web/src/middleware.ts" 절.
 *
 * 쿠키 형식만 검사한다(DB 재조회는 apps/api 호출 시점에 위임) — Edge 미들웨어에서
 * 매 네비게이션마다 DB 호출을 하면 모든 페이지 전환에 지연이 생기기 때문이다.
 */
export function middleware(request: NextRequest): NextResponse {
  const cookieValue = request.cookies.get(VISITOR_COOKIE_NAME)?.value;

  if (isValidVisitorEmailCookieValue(cookieValue)) {
    return NextResponse.next();
  }

  const originalPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const gateUrl = new URL("/gate", request.url);
  gateUrl.searchParams.set("next", originalPath);

  return NextResponse.redirect(gateUrl, 307);
}

export const config = {
  matcher: ["/((?!gate|_next|favicon.ico|manifest.json|sw.js|icons).*)"],
};

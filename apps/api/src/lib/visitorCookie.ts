/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md (v2) "쿠키 명세" 절.
 *
 * v2 재설계로 쿠키 발급(및 발급 옵션 결정)을 apps/api가 전담한다. `routes/auth.ts`가
 * `POST /api/sessions` 성공 시 이 옵션으로 `res.cookie(...)`를 호출한다.
 */

export const VISITOR_COOKIE_NAME = "dic_visitor_email";

// Express의 res.cookie는 maxAge를 밀리초 단위로 받는다 — 초 단위를 그대로 넘기면
// 실제 Max-Age 헤더가 180초로 잘못 발급되는 버그가 생긴다(단위 변환 주의).
export const VISITOR_COOKIE_MAX_AGE_MS = 15552000 * 1000;

export interface VisitorCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

export function buildVisitorCookieOptions(): VisitorCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: VISITOR_COOKIE_MAX_AGE_MS,
  };
}

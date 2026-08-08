/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md "쿠키 명세" 절.
 *
 * `middleware.ts`(형식 검사)와 `app/api/gate/verify/route.ts`(쿠키 발급 옵션)가 함께
 * 참조하는 공용 상수/순수 함수.
 */

export const VISITOR_COOKIE_NAME = "dic_visitor_email";
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 15552000;

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

export function isValidVisitorEmailCookieValue(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  if (value.length > MAX_EMAIL_LENGTH) {
    return false;
  }
  return EMAIL_FORMAT_REGEX.test(value);
}

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
    maxAge: VISITOR_COOKIE_MAX_AGE_SECONDS,
  };
}

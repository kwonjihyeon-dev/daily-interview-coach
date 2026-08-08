/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md (v2) "쿠키 명세" 절.
 *
 * v2 재설계로 쿠키 발급(옵션 결정)은 `apps/api/src/lib/visitorCookie.ts`가 전담한다.
 * 이 모듈은 `middleware.ts`(형식 검사)와 `gate/page.tsx`가 함께 참조하는 쿠키 이름/형식
 * 검사 전용 공용 상수·순수 함수만 유지한다.
 */

export const VISITOR_COOKIE_NAME = "dic_visitor_email";

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

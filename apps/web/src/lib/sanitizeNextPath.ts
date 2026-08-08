/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md
 * "게이트 페이지" 절의 오픈 리다이렉트 방지 규칙.
 *
 * 다음을 모두 만족해야 통과, 하나라도 위반하면 "/"로 대체한다.
 *   1. 정확히 "/"로 시작
 *   2. "//"로 시작하지 않음 (프로토콜 상대 URL 차단)
 *   3. "://"를 포함하지 않음 (절대 URL 차단)
 */
export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next) {
    return "/";
  }
  if (!next.startsWith("/")) {
    return "/";
  }
  if (next.startsWith("//")) {
    return "/";
  }
  if (next.includes("://")) {
    return "/";
  }
  return next;
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sanitizeNextPath } from "../../lib/sanitizeNextPath";
import { VISITOR_COOKIE_NAME, isValidVisitorEmailCookieValue } from "../../lib/visitorCookie";
import { GateForm } from "./GateForm";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md "게이트 페이지" 절.
 *
 * Server Component. 이미 유효한(형식 검사 통과) 쿠키가 있으면 폼을 그리지 않고 즉시
 * next(안전성 검증 후) 또는 "/"로 리다이렉트한다.
 */
interface GatePageProps {
  searchParams: Promise<{ next?: string; reason?: string }>;
}

export default async function GatePage(props: GatePageProps) {
  const searchParams = await props.searchParams;
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(VISITOR_COOKIE_NAME)?.value;

  if (isValidVisitorEmailCookieValue(cookieValue)) {
    redirect(sanitizeNextPath(searchParams.next));
  }

  const nextPath = sanitizeNextPath(searchParams.next);

  return (
    <main>
      {searchParams.reason === "expired" && (
        <p>인증이 만료되었습니다. 이메일을 다시 입력해주세요.</p>
      )}
      <GateForm nextPath={nextPath} />
    </main>
  );
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { VISITOR_COOKIE_NAME } from "./visitorCookie";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md
 * "인증된 apps/api 호출 래퍼 (apps/web/src/lib/authenticatedFetch.ts)" 절.
 *
 * 이후 모든 기능(이력서 업로드 등)이 apps/api를 호출할 때 이 함수를 거친다.
 * 브라우저는 apps/api의 존재를 모른다 — 쿠키 값을 x-user-email 헤더로 변환해 대신 호출한다.
 */
export async function authenticatedFetch(
  path: string,
  init?: RequestInit,
  currentPath: string = "/",
): Promise<Response> {
  const cookieStore = cookies();
  const visitorCookie = cookieStore.get(VISITOR_COOKIE_NAME);

  if (!visitorCookie?.value) {
    // 정상 흐름에서는 미들웨어가 먼저 걸러내지만, Server Action 등 미들웨어 매처가
    // 커버하지 않는 실행 경로에 대한 방어적 처리.
    redirect(`/gate?next=${encodeURIComponent(currentPath)}`);
    return new Response(null, { status: 307 });
  }

  const headers = {
    ...(init?.headers as Record<string, string> | undefined),
    "x-user-email": visitorCookie.value,
  };

  const response = await fetch(`${process.env.API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    // 쿠키는 형식상 유효했으나 그 사이 users 테이블에서 삭제된 경우 등.
    cookieStore.delete(VISITOR_COOKIE_NAME);
    redirect(`/gate?reason=expired&next=${encodeURIComponent(currentPath)}`);
    return response;
  }

  return response;
}

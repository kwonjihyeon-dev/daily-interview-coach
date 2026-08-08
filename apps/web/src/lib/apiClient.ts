import "server-only";
import { headers } from "next/headers";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md (v2)
 * "신규: apps/web/src/lib/apiClient.ts (SSR 전용 헬퍼, 함수형)" 절.
 *
 * Server Component/Route Handler/Server Action 컨텍스트에서 들어온 요청의 Cookie
 * 헤더를 그대로 apps/api에 전달한다. 401을 감지해도 `redirect()`를 직접 호출하지
 * 않고 판별 유니온(`ApiResult`)을 반환한다 — 실제 `redirect()` 호출은 항상 호출부
 * 책임이다(넓은 try/catch가 리다이렉트 신호를 삼킬 위험을 피하기 위함).
 */

export type ApiResult =
  | { kind: "ok"; response: Response }
  | { kind: "unauthenticated"; redirectTo: string };

async function request(
  method: string,
  path: string,
  init?: RequestInit,
  currentPath: string = "/",
): Promise<ApiResult> {
  const cookieHeader = headers().get("cookie") ?? "";
  const response = await fetch(`${process.env.API_BASE_URL}${path}`, {
    ...init,
    method,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      cookie: cookieHeader,
    },
  });

  if (response.status === 401) {
    return {
      kind: "unauthenticated",
      redirectTo: `/gate?reason=expired&next=${encodeURIComponent(currentPath)}`,
    };
  }
  return { kind: "ok", response };
}
// request는 export하지 않는다 — 모듈 밖에서 접근 불가(캡슐화). apiGet/apiPost/apiPut/apiDelete만
// 공개 인터페이스다.

export const apiGet = (path: string, init?: RequestInit, currentPath?: string) =>
  request("GET", path, init, currentPath);
export const apiPost = (path: string, init?: RequestInit, currentPath?: string) =>
  request("POST", path, init, currentPath);
export const apiPut = (path: string, init?: RequestInit, currentPath?: string) =>
  request("PUT", path, init, currentPath);
export const apiDelete = (path: string, init?: RequestInit, currentPath?: string) =>
  request("DELETE", path, init, currentPath);

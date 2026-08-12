"use server";

import { apiPost } from "../../lib/apiClient";
import { applySetCookieHeaders } from "../../lib/setCookieForwarding";

/**
 * 대상 스펙: .claude/artifacts/spec/클라이언트-데이터-계층-전환_spec.md "설계 판단 1" 절.
 *
 * v2까지 브라우저가 apps/api의 `/api/sessions`를 `credentials:"include"`로 직접 호출했지만,
 * 프로덕션에서 apps/api가 `127.0.0.1`에만 바인딩되면(deploy-topology-review.md 3절) 브라우저가
 * 더 이상 apps/api에 도달할 수 없다. 이 Server Action이 대신 `apiPost`로 apps/api를 호출하고,
 * apps/api가 발급한 `Set-Cookie` 헤더를 그대로 파싱해 Next의 `cookies().set()`으로 옮긴다 —
 * 쿠키 정책(Max-Age/HttpOnly/SameSite 등)은 apps/api가 계속 단독 소유한다.
 */

const GENERIC_FAILURE_MESSAGE = "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";

export type CreateVisitorSessionResult = { kind: "ok" } | { kind: "failed"; message: string };

export async function createVisitorSession(email: string): Promise<CreateVisitorSessionResult> {
  try {
    const result = await apiPost("/api/sessions", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (result.kind === "unauthenticated") {
      // /api/sessions는 인증 불필요 엔드포인트라 이론상 발생하지 않지만, apiPost의 타입
      // 계약상 항상 분기해야 한다(방어적).
      return { kind: "failed", message: GENERIC_FAILURE_MESSAGE };
    }

    if (!result.response.ok) {
      const body = await result.response.json();
      return { kind: "failed", message: body.message ?? "오류가 발생했습니다." };
    }

    const rawSetCookieHeaders = result.response.headers.getSetCookie();
    if (rawSetCookieHeaders.length === 0) {
      // 서버 이상 동작 — 201이지만 Set-Cookie가 없으면 성공으로 간주하지 않는다. 쿠키 없이
      // nextPath로 이동시키면 proxy.ts가 즉시 /gate로 되돌려보내 사용자가 혼란을 겪는다.
      return { kind: "failed", message: GENERIC_FAILURE_MESSAGE };
    }

    await applySetCookieHeaders(rawSetCookieHeaders);
    return { kind: "ok" };
  } catch {
    // 네트워크 단절, apps/api 무응답, JSON 파싱 실패를 모두 동일하게 처리한다.
    return { kind: "failed", message: GENERIC_FAILURE_MESSAGE };
  }
}

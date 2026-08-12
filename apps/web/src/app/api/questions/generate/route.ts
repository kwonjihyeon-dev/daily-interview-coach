import { NextResponse, type NextRequest } from "next/server";
import { apiPost } from "../../../../lib/apiClient";

/**
 * 대상 스펙: .claude/artifacts/spec/클라이언트-데이터-계층-전환_spec.md "설계 판단 3" 절.
 *
 * 질문 생성(Bedrock 호출)은 수십 초가 걸릴 수 있는데, Next는 같은 브라우저 탭의 모든 Server
 * Action 호출을 전역적으로 직렬 처리한다("Next.js dispatches Server Actions one at a time
 * per client" — apps/web/node_modules/next/dist/docs/01-app/02-guides/server-actions.md:28).
 * 그래서 이 호출은 Server Action이 아니라 Route Handler로 둔다(문서가 병렬이 필요하면
 * Route Handler를 쓰라고 명시).
 *
 * 핵심 설계 의도: apps/api 응답 계약(상태 코드, `{error, message}`/`{question, questions}`
 * 바디 형태)을 그대로 통과시킨다. 그래야 ResumeUploadForm.tsx/EmptyQuestionState.tsx의
 * 기존 401 리다이렉트·에러 매핑 로직을 수정 없이 재사용할 수 있다 — 클라이언트에서 바뀌는
 * 것은 호출 URL(절대경로 → 상대경로)과 `credentials:"include"` 제거뿐이다.
 */

const INTERNAL_ERROR_MESSAGE = "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    // 방어적 — 정상 클라이언트는 항상 유효한 JSON을 보내므로 실사용 경로에서는 발생하지 않음.
    return NextResponse.json(
      { error: "invalid_request", message: "잘못된 요청입니다." },
      { status: 400 },
    );
  }

  try {
    const result = await apiPost("/api/questions/generate", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsedBody),
    });

    if (result.kind === "unauthenticated") {
      // apps/api의 requireAuthenticatedUser 401 응답과 동일한 메시지로 통일한다 —
      // 클라이언트의 기존 401 감지 로직이 수정 없이 그대로 동작한다.
      return NextResponse.json(
        { error: "unauthorized", message: "인증되지 않은 요청입니다." },
        { status: 401 },
      );
    }

    const body = await result.response.json();
    return NextResponse.json(body, { status: result.response.status });
  } catch {
    // apps/api 호출 실패(프로세스 다운 등)와 응답 JSON 파싱 실패를 모두 동일하게 처리한다.
    return NextResponse.json(
      { error: "internal_error", message: INTERNAL_ERROR_MESSAGE },
      { status: 500 },
    );
  }
}

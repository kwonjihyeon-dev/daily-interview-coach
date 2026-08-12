"use server";

import type { Source } from "@daily-interview-coach/shared-types";
import { apiPost } from "../lib/apiClient";

/**
 * 대상 스펙: .claude/artifacts/spec/클라이언트-데이터-계층-전환_spec.md "설계 판단 1"(구조는
 * gate/actions.ts와 동일한 패턴) + "파일 변경 목록" 절의 `UploadResumeResult` 동작 설명.
 *
 * v2까지 브라우저가 apps/api의 `/api/sources/resume`을 `credentials:"include"`로 직접
 * multipart 업로드했지만, 프로덕션에서 apps/api가 `127.0.0.1`에만 바인딩되면(deploy-topology-
 * review.md 3절) 브라우저가 더 이상 apps/api에 도달할 수 없어, 이 Server Action이 대신
 * `apiPost`로 전달한다. Content-Type을 수동 설정하지 않는다 — fetch가 multipart 바운더리를
 * 자동 생성한다(기존 동작과 동일).
 */

const GENERIC_FAILURE_MESSAGE = "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";

export type UploadResumeResult =
  | { kind: "success"; source: Source }
  | { kind: "unauthenticated"; redirectTo: string }
  | { kind: "failed"; message: string };

export async function uploadResume(formData: FormData): Promise<UploadResumeResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { kind: "failed", message: "업로드할 파일이 없습니다." };
  }

  try {
    const forwardedFormData = new FormData();
    forwardedFormData.append("file", file);

    const result = await apiPost("/api/sources/resume", { body: forwardedFormData });

    if (result.kind === "unauthenticated") {
      return { kind: "unauthenticated", redirectTo: result.redirectTo };
    }

    const body = await result.response.json();

    if (!result.response.ok) {
      return { kind: "failed", message: body.message ?? "오류가 발생했습니다." };
    }

    return { kind: "success", source: body.source };
  } catch {
    // 네트워크 단절, apps/api 무응답, JSON 파싱 실패를 모두 동일하게 처리한다.
    return { kind: "failed", message: GENERIC_FAILURE_MESSAGE };
  }
}

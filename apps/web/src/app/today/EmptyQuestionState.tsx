"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Question } from "@daily-interview-coach/shared-types";

/**
 * 대상 스펙: .claude/artifacts/spec/질문-생성_spec.md (v2) "프론트엔드 — 신규 /today 페이지
 * > EmptyQuestionState.tsx (Client Component, v2 신규)" 절.
 *
 * `apiClient.ts`는 `import "server-only"`가 붙어 있어 이 컴포넌트에서 쓸 수 없으므로,
 * ResumeUploadForm.tsx/GateForm.tsx와 동일한 아키텍처로 브라우저가 apps/api를
 * `${NEXT_PUBLIC_API_BASE_URL}/api/questions/generate`에 credentials:"include"로 직접
 * 호출한다. "다시 시도"는 GET /api/questions/today가 아니라 POST /api/questions/generate를
 * sourceId 없이({}) 직접 호출한다(v2 확정 지침) — 별도의 GET /today 재호출은 하지 않는다.
 */

type RegenerationStatus = "idle" | "generating" | "ready" | "error";

export function EmptyQuestionState() {
  const router = useRouter();
  const [status, setStatus] = useState<RegenerationStatus>("idle");
  const [question, setQuestion] = useState<Question | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function regenerateQuestions(): Promise<void> {
    setStatus("generating");
    setErrorMessage(null);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/questions/generate`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      if (response.status === 401) {
        router.replace("/gate?reason=expired&next=%2Ftoday");
        return;
      }

      const body = await response.json();

      if (!response.ok) {
        setStatus("error");
        setErrorMessage(body.message ?? "질문 생성에 실패했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }

      setQuestion(body.question);
      setStatus("ready");
    } catch {
      setStatus("error");
      setErrorMessage("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    }
  }

  if (status === "ready" && question) {
    return <p>{question.text}</p>;
  }

  return (
    <div>
      <p>질문 생성에 문제가 있어요. 한번 더 시도해주세요</p>
      {errorMessage && <p>{errorMessage}</p>}
      <button
        type="button"
        onClick={() => void regenerateQuestions()}
        disabled={status === "generating"}
      >
        {status === "generating" ? "생성 중..." : "다시 시도"}
      </button>
    </div>
  );
}

import { redirect } from "next/navigation";
import type { Question } from "@daily-interview-coach/shared-types";
import { apiGet } from "../../lib/apiClient";
import { EmptyQuestionState } from "./EmptyQuestionState";

/**
 * 대상 스펙: .claude/artifacts/spec/질문-생성_spec.md (v2) "프론트엔드 — 신규 /today 페이지"
 * 절. Server Component — GET /api/questions/today를 서버에서 호출해 오늘의 질문을 렌더링한다.
 *
 * `question`이 null이면(v2 — "질문 소진"으로 간주) `EmptyQuestionState`(Client Component)를
 * 렌더링해 재생성 흐름을 맡긴다.
 */
export default async function TodayPage() {
  const result = await apiGet("/api/questions/today", undefined, "/today");

  if (result.kind === "unauthenticated") {
    redirect(result.redirectTo);
    return null;
  }

  if (!result.response.ok) {
    return <p>질문을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>;
  }

  const body = (await result.response.json()) as { question: Question | null };

  if (!body.question) {
    return <EmptyQuestionState />;
  }

  return <p>{body.question.text}</p>;
}

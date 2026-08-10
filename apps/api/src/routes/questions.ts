import { Router, type Request, type Response } from "express";
import { supabase } from "../lib/supabaseClient";
import { requireAuthenticatedUser } from "../middleware/requireAuthenticatedUser";
import {
  GenerationFailedError,
  PREFETCH_THRESHOLD,
  QuestionPersistenceError,
  findLatestResumeSourceId,
  generateAndSaveQuestionBatch,
  selectTodayQuestion,
} from "../lib/questionGeneration";

/**
 * 대상 스펙: .claude/artifacts/spec/질문-생성_spec.md (v2, Approved)
 *
 * `POST /generate`, `GET /today` 라우터. 인증(`requireAuthenticatedUser`)은 resume.ts와
 * 동일하게 이 라우터 내부에서 직접 체이닝한다.
 *
 * `sourceId` 해석("생략 시 findLatestResumeSourceId", "제공 시 sources 테이블에서
 * id+user_id로 존재/타입 확인")은 이 라우트가 직접 수행하고, 프롬프트 구성 → Bedrock 호출
 * → 파싱 → batch insert → "오늘의 질문" 선택은 `lib/questionGeneration.ts`가 전담한다.
 */

const router: ReturnType<typeof Router> = Router();

function sendError(res: Response, status: number, error: string, message: string): void {
  res.status(status).json({ error, message });
}

interface SourceRow {
  id: string;
  type: string;
  raw_text: string;
}

/**
 * `sourceId` 해석 규칙(스펙 v2, 2단계):
 * 1. body에 sourceId 키 자체가 없으면 findLatestResumeSourceId로 fallback.
 * 2. 키가 있지만 비어있지 않은 문자열이 아니면 invalid_source_id.
 * 3. 유효한 문자열이면 그대로 사용(존재/소유/타입 확인은 이후 별도 쿼리로 수행).
 */
async function resolveSourceId(
  userId: string,
  body: Record<string, unknown>,
): Promise<{ sourceId: string } | { errorCode: "invalid_source_id" | "source_not_found" }> {
  if (!("sourceId" in body)) {
    const latestId = await findLatestResumeSourceId(userId);
    if (!latestId) {
      return { errorCode: "source_not_found" };
    }
    return { sourceId: latestId };
  }

  const { sourceId } = body;
  if (typeof sourceId !== "string" || sourceId.length === 0) {
    return { errorCode: "invalid_source_id" };
  }

  return { sourceId };
}

async function fetchOwnedSource(userId: string, sourceId: string): Promise<SourceRow | null> {
  const { data, error } = await supabase
    .from("sources")
    .select("id, type, raw_text")
    .eq("id", sourceId)
    .eq("user_id", userId);

  if (error) {
    throw new QuestionPersistenceError("sources 조회 실패");
  }

  const rows = (data ?? []) as SourceRow[];
  return rows[0] ?? null;
}

async function generateQuestions(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      sendError(res, 401, "unauthorized", "인증되지 않은 요청입니다.");
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const resolved = await resolveSourceId(user.id, body);

    if ("errorCode" in resolved) {
      if (resolved.errorCode === "invalid_source_id") {
        sendError(res, 400, "invalid_source_id", "유효하지 않은 이력서 식별자입니다.");
      } else {
        sendError(res, 404, "source_not_found", "이력서를 찾을 수 없습니다.");
      }
      return;
    }

    const source = await fetchOwnedSource(user.id, resolved.sourceId);
    if (!source) {
      sendError(res, 404, "source_not_found", "이력서를 찾을 수 없습니다.");
      return;
    }
    if (source.type !== "resume") {
      sendError(
        res,
        400,
        "unsupported_source_type",
        "현재는 이력서 기반 질문 생성만 지원합니다.",
      );
      return;
    }

    const questions = await generateAndSaveQuestionBatch(user.id, {
      id: source.id,
      rawText: source.raw_text,
    });
    const question = await selectTodayQuestion(user.id);

    res.status(201).json({ questions, question });
  } catch (err) {
    if (err instanceof GenerationFailedError) {
      sendError(
        res,
        500,
        "generation_failed",
        "질문 생성에 실패했습니다. 잠시 후 다시 시도해주세요.",
      );
      return;
    }
    console.error("[questions] generate 처리 중 오류:", err);
    sendError(res, 500, "internal_error", "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.");
  }
}

/**
 * "미리 채워두기" — 미답변 질문 잔여 개수가 PREFETCH_THRESHOLD 이하이면 fire-and-forget으로
 * 다음 배치를 재생성한다. 이 로직의 성공/실패는 GET /today 응답에 전혀 영향을 주지 않는다.
 */
async function prefetchNextBatchIfNeeded(userId: string): Promise<void> {
  const { data, error, count } = await supabase
    .from("questions")
    .select("id, answers!left(id)", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("answers.id", null);

  if (error) {
    throw error;
  }

  const unansweredCount = count ?? (Array.isArray(data) ? data.length : 0);
  if (unansweredCount > PREFETCH_THRESHOLD) {
    return;
  }

  const latestResumeSourceId = await findLatestResumeSourceId(userId);
  if (!latestResumeSourceId) {
    return;
  }

  const source = await fetchOwnedSource(userId, latestResumeSourceId);
  if (!source) {
    return;
  }

  await generateAndSaveQuestionBatch(userId, { id: source.id, rawText: source.raw_text });
}

async function getTodayQuestion(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) {
    sendError(res, 401, "unauthorized", "인증되지 않은 요청입니다.");
    return;
  }

  let question;
  try {
    question = await selectTodayQuestion(user.id);
  } catch (err) {
    console.error("[questions] today 조회 실패:", err);
    sendError(res, 500, "internal_error", "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.");
    return;
  }

  res.status(200).json({ question });

  prefetchNextBatchIfNeeded(user.id).catch((err) => {
    console.error("[questions] prefetch 실패:", err);
  });
}

router.post("/generate", requireAuthenticatedUser, generateQuestions);
router.get("/today", requireAuthenticatedUser, getTodayQuestion);

export default router;

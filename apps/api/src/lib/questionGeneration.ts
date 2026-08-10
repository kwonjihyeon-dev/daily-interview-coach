import { randomUUID } from "crypto";
import type { Question } from "@daily-interview-coach/shared-types";
import { supabase } from "./supabaseClient";
import { generateInterviewQuestions } from "./bedrockClient";

/**
 * 대상 스펙: .claude/artifacts/spec/질문-생성_spec.md (v2)
 *
 * 프롬프트 구성, Bedrock 응답 파싱, 생성·저장, "오늘의 질문" 선택 로직을 모은 모듈.
 * `routes/questions.ts`는 이 함수들을 호출만 하고 sourceId 해석/검증은 라우트가 직접
 * 수행한다(테스트 설계 문서의 책임 분담 전제와 동일).
 */

export const REQUESTED_QUESTION_COUNT = 15;
export const MIN_VALID_QUESTIONS = 5;
export const MAX_QUESTIONS_STORED = 30;
export const PREFETCH_THRESHOLD = 5;
export const EXISTING_QUESTIONS_CONTEXT_LIMIT = 100;

/** Bedrock 호출 자체 실패 또는 응답 파싱/검증 실패 — 500 generation_failed로 매핑된다. */
export class GenerationFailedError extends Error {}

/** DB 조회/저장 실패 — 500 internal_error로 매핑된다. */
export class QuestionPersistenceError extends Error {}

interface ParsedQuestionItem {
  category: string;
  text: string;
}

interface GenerationSource {
  id: string;
  rawText: string;
}

/** DB(UTC ISO 8601) → KST(+09:00) ISO 8601 문자열 변환 (resume.ts의 toKstIso와 동일 규칙) */
export function toKstIso(utcIso: string): string {
  const utcDate = new Date(utcIso);
  const kstDate = new Date(utcDate.getTime() + 9 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");

  const yyyy = kstDate.getUTCFullYear();
  const mm = pad(kstDate.getUTCMonth() + 1);
  const dd = pad(kstDate.getUTCDate());
  const hh = pad(kstDate.getUTCHours());
  const min = pad(kstDate.getUTCMinutes());
  const ss = pad(kstDate.getUTCSeconds());

  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+09:00`;
}

function normalizeForDedup(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

function mapRowToQuestion(row: Record<string, unknown>): Question {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    sourceId: (row.source_id as string | null) ?? null,
    category: row.category as string,
    text: row.text as string,
    origin: row.origin as Question["origin"],
    createdAt: toKstIso(row.created_at as string),
  };
}

/** 프롬프트 설계 (질문-생성_spec.md "프롬프트 설계" 절, v2 — 페르소나 "15년차 이상") */
export function buildQuestionGenerationPrompt(
  rawText: string,
  existingQuestionTexts: string[],
): string {
  const hasExisting = existingQuestionTexts.length > 0;
  const limitedExisting = existingQuestionTexts.slice(0, EXISTING_QUESTIONS_CONTEXT_LIMIT);
  const rule6 = hasExisting
    ? `\n6. 아래 "이미 생성된 질문 목록"에 있는 질문과 내용이 겹치지 않게 생성하세요.`
    : "";
  const existingContent = hasExisting ? limitedExisting.join("\n") : "(없음)";

  return `당신은 15년차 이상 소프트웨어 개발자로 일하고 있는 면접관입니다. 아래 지원자의 이력서를 읽고,
실제 면접에서 물어볼 질문을 생성해주세요.

[규칙]
1. 이력서에 명시적으로 등장하는 키워드/기술에만 국한하지 마세요. 그 기술과 연관된 더 넓은
개념이나 트레이드오프까지 확장해서 질문을 만드세요. 예를 들어 이력서에 "Next.js로
마이그레이션해 성능을 개선했다"는 내용이 있다면, Next.js의 SSR 개념 자체를 묻는 질문뿐
아니라, SSR이 갖는 트레이드오프(서버가 한 단계 더 개입하면서 발생할 수 있는 지연 등)에
대해 지원자가 어떻게 생각하는지 묻는 질문도 포함하세요.
2. 목적은 "이력서 내용이 사실인지 확인"이 아니라 "면접 준비"입니다. 이력서에 직접
언급되지 않은 인접 개념도 다루세요.
3. 카테고리별로 정해진 최소 개수는 없습니다. 이력서를 보고 실제로 물어볼 만한 질문
위주로 자유롭게 구성하세요.
4. 생성하는 질문 중 일부(전부는 아님)는 단순 사실 확인이 아니라 "~에 대해 어떻게 생각하나요"처럼
지원자의 사고와 트레이드오프 판단을 묻는 질문으로 만드세요.
5. 정확히 ${REQUESTED_QUESTION_COUNT}개의 질문을 생성하세요.${rule6}

[출력 형식]
다른 설명 없이 아래 JSON 배열 형식으로만 응답하세요. 각 항목은 category(질문의 짧은
주제 라벨)와 text(질문 전문)로 구성됩니다.
[{"category": "...", "text": "..."}, ...]

[이력서]
${rawText}

[이미 생성된 질문 목록] (있는 경우, 최근 ${EXISTING_QUESTIONS_CONTEXT_LIMIT}개까지)
${existingContent}`;
}

/**
 * Bedrock 응답 텍스트를 파싱·검증한다("응답 파싱 규칙" 1~6단계).
 * 유효 질문이 MIN_VALID_QUESTIONS 미만이면 null을 반환한다(호출측이 generation_failed로 매핑).
 */
export function parseGeneratedQuestions(
  rawResponseText: string,
  existingQuestionTexts: string[],
): ParsedQuestionItem[] | null {
  const stripped = stripCodeFence(rawResponseText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  const existingNormalized = new Set(existingQuestionTexts.map(normalizeForDedup));
  const seenInBatch = new Set<string>();
  const validItems: ParsedQuestionItem[] = [];

  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;

    const category = typeof record.category === "string" ? record.category.trim() : "";
    const text = typeof record.text === "string" ? record.text.trim() : "";

    if (category.length < 1 || category.length > 50) continue;
    if (text.length < 1 || text.length > 500) continue;

    const normalized = normalizeForDedup(text);
    if (seenInBatch.has(normalized) || existingNormalized.has(normalized)) continue;

    seenInBatch.add(normalized);
    validItems.push({ category, text });
  }

  if (validItems.length < MIN_VALID_QUESTIONS) {
    return null;
  }

  return validItems.slice(0, MAX_QUESTIONS_STORED);
}

/**
 * 해당 사용자의 type='resume' source 중 가장 최근 생성된 것의 id를 찾는다.
 * (`sourceId` 생략 fallback과 prefetch가 공유)
 */
export async function findLatestResumeSourceId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("sources")
    .select("id, created_at")
    .eq("user_id", userId)
    .eq("type", "resume")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new QuestionPersistenceError("resume source 조회 실패");
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.length > 0 ? (rows[0].id as string) : null;
}

/**
 * 프롬프트 구성 → Bedrock 호출 → 파싱 → batch insert까지 전담한다(POST /generate의
 * 5~7단계, prefetch가 재사용).
 */
export async function generateAndSaveQuestionBatch(
  userId: string,
  source: GenerationSource,
): Promise<Question[]> {
  const { data: existingRows, error: existingError } = await supabase
    .from("questions")
    .select("text")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(EXISTING_QUESTIONS_CONTEXT_LIMIT);

  if (existingError) {
    throw new QuestionPersistenceError("기존 질문 조회 실패");
  }

  const existingQuestionTexts = ((existingRows ?? []) as Array<Record<string, unknown>>).map(
    (row) => row.text as string,
  );

  const prompt = buildQuestionGenerationPrompt(source.rawText, existingQuestionTexts);

  let rawResponse: string;
  try {
    rawResponse = await generateInterviewQuestions(prompt);
  } catch {
    throw new GenerationFailedError("Bedrock 호출 실패");
  }

  const parsedItems = parseGeneratedQuestions(rawResponse, existingQuestionTexts);
  if (!parsedItems) {
    throw new GenerationFailedError("유효한 질문 생성 실패");
  }

  const rows = parsedItems.map((item) => ({
    id: randomUUID(),
    user_id: userId,
    source_id: source.id,
    category: item.category,
    text: item.text,
    origin: "ai" as const,
  }));

  const { data: insertedRows, error: insertError } = await supabase
    .from("questions")
    .insert(rows)
    .select();

  if (insertError || !insertedRows) {
    throw new QuestionPersistenceError("questions insert 실패");
  }

  return (insertedRows as Array<Record<string, unknown>>).map(mapRowToQuestion);
}

/**
 * 해당 사용자의 미답변 질문 중 생성일(오름차순, FIFO) 첫 번째를 선택한다
 * (`GET /today`와 `POST /generate` 응답이 공유).
 */
export async function selectTodayQuestion(userId: string): Promise<Question | null> {
  const { data, error } = await supabase
    .from("questions")
    .select("id,user_id,source_id,category,text,origin,created_at,answers(id)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new QuestionPersistenceError("questions 조회 실패");
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const unanswered = rows.find((row) => {
    const answers = row.answers as unknown[] | null | undefined;
    return !answers || answers.length === 0;
  });

  return unanswered ? mapRowToQuestion(unanswered) : null;
}

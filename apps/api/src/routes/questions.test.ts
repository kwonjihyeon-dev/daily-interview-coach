import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { NextFunction, Request, Response } from "express";
import questionsRouter from "./questions";

/**
 * 대상 스펙: .claude/artifacts/spec/질문-생성_spec.md (v2, Approved)
 *
 * ## 이 테스트가 다루는 것 / 다루지 않는 것
 *
 * `resume.test.ts`와 동일하게 `requireAuthenticatedUser`(인증 미들웨어)는 완전히
 * 모킹한다 — 이 파일은 인증 성공을 가정한 뒤 `questions.ts` 라우트(+ 그 내부에서 사용하는
 * `lib/questionGeneration.ts`, `lib/bedrockClient.ts`)가 스펙대로 동작하는지만 검증한다.
 *
 * `../lib/supabaseClient`와 `../lib/bedrockClient`(AWS Bedrock 호출 wrapper)만 진짜
 * 외부 경계로 보고 모킹하며, `questionGeneration.ts`(프롬프트 구성/파싱/저장/선택 로직)는
 * 모킹하지 않고 실제로 실행되도록 둔다 — "Bedrock에 전달된 prompt에 핵심 substring이
 * 포함되는지", "questions 테이블에 실제로 N개 row가 추가되는지" 같은 스펙의 Acceptance
 * Criteria가 이 경계에서만 관찰 가능하기 때문이다.
 *
 * ## Supabase 쿼리 모킹 방식(중요 — 구현 계약의 일부)
 *
 * `sources`/`questions` 테이블 각각에 대해, `.from(table)`이 반환하는 체이너블 객체는
 * `select/eq/order/limit/in/is/match` 등 **어떤 체이닝 메서드가 와도** 자기 자신을
 * 반환하고(구체적 쿼리 빌더 메서드 조합에 결합하지 않기 위함), `await`되는 시점(`.then`)
 * 또는 `.single()`/`.maybeSingle()` 호출 시점에 등록된 결과를 반환한다.
 * - `sourcesResolve()` / `questionsResolve()`: 매 호출마다 순차 소비되는 `mockResolvedValueOnce`
 *   큐 → 소진되면 마지막 `mockResolvedValue`(기본값)로 폴백. `.single()`이 호출되면
 *   `data`가 배열이면 첫 원소로, 아니면 그대로 unwrap해서 반환한다(실제 구현이 `.single()`을
 *   쓰든 안 쓰든 동일한 큐 설정으로 대응 가능).
 * - `questions` 테이블의 `.insert(rows)`는 별도로 `questionsInsert` 스파이에 인자를 기록하고,
 *   `questionsInsertResolve(rows)`(기본: 각 row에 `created_at`을 붙여 그대로 반환하는 echo)로
 *   결과를 결정한다.
 *
 * 이 테스트는 아래와 같은 라우트/lib 책임 분담을 전제한다(스펙의 "sourceId 해석 규칙"과
 * "처리 순서" 표를 그대로 따른 가장 단순한 해석):
 * - `sourceId` 해석(생략 시 `findLatestResumeSourceId` 사용, 제공 시 형식 검증)과
 *   "sources 테이블에서 `id`+`user_id`로 존재/타입 확인" 쿼리는 라우트가 직접 수행한다.
 * - 프롬프트 구성 → Bedrock 호출 → 파싱 → batch insert → `selectTodayQuestion` 호출은
 *   `generateAndSaveQuestionBatch`/`selectTodayQuestion`(둘 다 `questionGeneration.ts`)이
 *   담당하며, 라우트는 이 함수들을 호출만 한다.
 */

type MockedUser = { id: string; email: string };

const TEST_USER: MockedUser = {
  id: "1a2b3c4d-1111-4111-8111-111111111111",
  email: "visitor@example.com",
};

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const REQUESTED_QUESTION_COUNT = 15;
const MIN_VALID_QUESTIONS = 5;
const MAX_QUESTIONS_STORED = 30;
const PREFETCH_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// 인증 미들웨어 모킹 (resume.test.ts와 동일 패턴)
// ---------------------------------------------------------------------------
const authMock = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
}));
vi.mock("../middleware/requireAuthenticatedUser", () => authMock);

// ---------------------------------------------------------------------------
// Bedrock 호출 래퍼 모킹 (유일한 AI 호출 경계)
// ---------------------------------------------------------------------------
const bedrockMock = vi.hoisted(() => ({
  generateInterviewQuestions: vi.fn(),
}));
vi.mock("../lib/bedrockClient", () => bedrockMock);

// ---------------------------------------------------------------------------
// Supabase 클라이언트 모킹 (제네릭 체이너블 + 테이블별 큐)
// ---------------------------------------------------------------------------
const supabaseMock = vi.hoisted(() => {
  const sourcesResolve = vi.fn();
  const questionsResolve = vi.fn();
  const questionsInsertResolve = vi.fn();
  const questionsInsert = vi.fn();

  type RawResult = { data: unknown; error: unknown; count?: number };

  function chainable(terminal: () => unknown | Promise<unknown>): unknown {
    const target: Record<string, unknown> = {};
    const proxy: unknown = new Proxy(target, {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(terminal()).then(resolve, reject);
        }
        if (prop === "single" || prop === "maybeSingle") {
          return () => ({
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
              Promise.resolve(terminal()).then((raw) => {
                const r = raw as RawResult;
                const unwrapped = Array.isArray(r.data) ? (r.data[0] ?? null) : (r.data ?? null);
                resolve({ data: unwrapped, error: r.error ?? null });
              }, reject),
          });
        }
        // 임의의 체이닝 메서드(select/eq/order/limit/in/is/match/...)는 전부 자기 자신을
        // 반환한다 — 구체적인 쿼리 빌더 메서드 조합에 결합하지 않기 위함.
        return (..._args: unknown[]) => proxy;
      },
    });
    return proxy;
  }

  function questionsBuilder(): unknown {
    const base = chainable(() => questionsResolve());
    return new Proxy(base as object, {
      get(target, prop, receiver) {
        if (prop === "insert") {
          return (rows: unknown) => {
            questionsInsert(rows);
            return chainable(() => questionsInsertResolve(rows));
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  const from = vi.fn((table: string) => {
    if (table === "sources") return chainable(() => sourcesResolve());
    if (table === "questions") return questionsBuilder();
    throw new Error(`questions.test.ts의 supabase mock이 예상하지 못한 테이블: ${table}`);
  });

  return { from, sourcesResolve, questionsResolve, questionsInsertResolve, questionsInsert };
});
vi.mock("../lib/supabaseClient", () => ({ supabase: { from: supabaseMock.from } }));

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/questions", questionsRouter);
  return app;
}

const NOW_UTC = "2026-08-06T00:12:00+00:00";

/** DB(UTC ISO 8601) → KST(+09:00) ISO 8601 (resume.ts의 toKstIso와 동일 규칙) */
function toKst(utcIso: string): string {
  const utcDate = new Date(utcIso);
  const kstDate = new Date(utcDate.getTime() + 9 * 60 * 60 * 1000);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${kstDate.getUTCFullYear()}-${pad(kstDate.getUTCMonth() + 1)}-${pad(kstDate.getUTCDate())}T${pad(kstDate.getUTCHours())}:${pad(kstDate.getUTCMinutes())}:${pad(kstDate.getUTCSeconds())}+09:00`;
}

function sourceRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    user_id: TEST_USER.id,
    type: "resume",
    raw_text:
      "저는 프론트엔드 개발자입니다. Next.js로 마이그레이션해 성능을 개선한 경험이 있습니다.",
    source_url: "resumes/x.pdf",
    created_at: NOW_UTC,
    ...overrides,
  };
}

/** Bedrock이 반환할 JSON 배열 문자열을 만든다. */
function bedrockJson(items: Array<{ category: string; text: string }>): string {
  return JSON.stringify(items);
}

function fencedBedrockJson(items: Array<{ category: string; text: string }>): string {
  return "```json\n" + JSON.stringify(items) + "\n```";
}

function validItems(count: number, prefix = "질문"): Array<{ category: string; text: string }> {
  return Array.from({ length: count }, (_, i) => ({
    category: `카테고리-${i + 1}`,
    text: `${prefix}-${i + 1}: 이것은 ${i + 1}번째로 생성된 면접 질문의 전문입니다.`,
  }));
}

/** questions 테이블에 대해 "미답변 질문 없음(question:null)"을 기본값으로 만든다. */
function defaultQuestionsResolve() {
  return { data: [], error: null, count: 0 };
}

beforeEach(() => {
  vi.clearAllMocks();

  authMock.requireAuthenticatedUser.mockImplementation(
    (req: Request & { user?: MockedUser }, _res: Response, next: NextFunction) => {
      req.user = TEST_USER;
      next();
    },
  );

  // 기본값: 유효한 이력서 source가 언제나 조회된다 (개별 테스트에서 override)
  supabaseMock.sourcesResolve.mockResolvedValue({ data: [sourceRow()], error: null });
  // 기본값: 기존 질문 없음 / 미답변 질문 없음 / prefetch count 0
  supabaseMock.questionsResolve.mockResolvedValue(defaultQuestionsResolve());
  // 기본값: insert는 보낸 row에 created_at을 붙여 그대로 돌려준다 (resume.test.ts의
  // lastInsertedRow() echo 패턴과 동일한 취지)
  supabaseMock.questionsInsertResolve.mockImplementation((rows: unknown) => ({
    data: (rows as Record<string, unknown>[]).map((r) => ({ ...r, created_at: NOW_UTC })),
    error: null,
  }));
  // 기본값: Bedrock은 유효한 15개를 반환한다
  bedrockMock.generateInterviewQuestions.mockResolvedValue(bedrockJson(validItems(REQUESTED_QUESTION_COUNT)));
});

describe("POST /api/questions/generate", () => {
  describe("정상 시나리오", () => {
    it("이력서 source(rawText, 기존 질문 없음)로 요청하면 Bedrock 프롬프트에 필수 문구가 모두 포함되고 201과 함께 questions 15개가 반환된다", async () => {
      // Given
      const app = buildApp();
      const source = sourceRow();
      supabaseMock.sourcesResolve.mockResolvedValue({ data: [source], error: null });
      supabaseMock.questionsResolve
        .mockResolvedValueOnce({ data: [], error: null }) // 기존 질문 조회 (없음)
        .mockResolvedValueOnce({ data: [], error: null }); // selectTodayQuestion (새로 삽입된 것 외엔 없음 → 후속 검증에서 대체)

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({ sourceId: source.id });

      // Then: prompt에 핵심 substring이 모두 포함된다
      expect(bedrockMock.generateInterviewQuestions).toHaveBeenCalledTimes(1);
      const prompt = bedrockMock.generateInterviewQuestions.mock.calls[0][0] as string;
      expect(prompt).toContain("15년차 이상");
      expect(prompt).toContain("트레이드오프");
      expect(prompt).toContain("어떻게 생각하나요");
      expect(prompt).toContain(`정확히 ${REQUESTED_QUESTION_COUNT}개`);
      expect(prompt).toContain(source.raw_text);

      // And: 201 응답과 questions 배열(길이 15)
      expect(res.status).toBe(201);
      expect(res.body.questions).toHaveLength(15);
      for (const q of res.body.questions) {
        expect(q.userId).toBe(TEST_USER.id);
        expect(q.sourceId).toBe(source.id);
        expect(q.origin).toBe("ai");
        expect(q.id).toMatch(new RegExp(`^${UUID_PATTERN}$`));
      }

      // And: questions 테이블에 실제로 15개 row가 삽입된다
      expect(supabaseMock.questionsInsert).toHaveBeenCalledTimes(1);
      const insertedRows = supabaseMock.questionsInsert.mock.calls[0][0] as Record<
        string,
        unknown
      >[];
      expect(insertedRows).toHaveLength(15);
      for (const row of insertedRows) {
        expect(row.user_id).toBe(TEST_USER.id);
        expect(row.source_id).toBe(source.id);
        expect(row.origin).toBe("ai");
      }
    });

    it("응답의 question 필드는 방금 삽입된 배치 중 가장 먼저 생성된 질문과 일치한다", async () => {
      // Given: 기존 미답변 질문 없음. selectTodayQuestion은 방금 삽입된 batch를 다시 조회해
      // 그 중 가장 먼저 생성된 것을 골라야 하므로, insert가 실제로 보낸 rows를 기반으로
      // selectTodayQuestion 쿼리의 응답을 구성한다(첫 번째로 삽입 요청된 row가 가장 먼저
      // 생성된 것으로 취급된다).
      const app = buildApp();
      const source = sourceRow();
      supabaseMock.sourcesResolve.mockResolvedValue({ data: [source], error: null });
      supabaseMock.questionsResolve.mockResolvedValueOnce({ data: [], error: null }); // 기존 질문 없음
      supabaseMock.questionsResolve.mockImplementationOnce(() => {
        const insertedRows = supabaseMock.questionsInsert.mock.calls.at(-1)?.[0] as
          | Record<string, unknown>[]
          | undefined;
        const rows = (insertedRows ?? []).map((r, i) => ({
          ...r,
          created_at: new Date(Date.parse(NOW_UTC) + i * 1000).toISOString(),
          answers: [],
        }));
        return { data: rows, error: null };
      });

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({ sourceId: source.id });

      // Then
      expect(res.status).toBe(201);
      expect(res.body.question).toBeDefined();
      expect(res.body.question.id).toBe(res.body.questions[0].id);
    });

    it("기존 origin='ai' 질문(A,B,C)이 있으면 prompt에 '이미 생성된 질문 목록'과 A,B,C가 포함되고, 새 질문들의 sourceId는 새 source.id다", async () => {
      // Given
      const app = buildApp();
      const newSource = sourceRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
      supabaseMock.sourcesResolve.mockResolvedValue({ data: [newSource], error: null });
      supabaseMock.questionsResolve
        .mockResolvedValueOnce({ data: [{ text: "A" }, { text: "B" }, { text: "C" }], error: null })
        .mockResolvedValueOnce({ data: [], error: null });

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({ sourceId: newSource.id });

      // Then
      expect(res.status).toBe(201);
      const prompt = bedrockMock.generateInterviewQuestions.mock.calls[0][0] as string;
      expect(prompt).toContain("이미 생성된 질문 목록");
      expect(prompt).toContain("A");
      expect(prompt).toContain("B");
      expect(prompt).toContain("C");

      // And: 새로 저장되는 질문들의 sourceId는 새 source.id
      const insertedRows = supabaseMock.questionsInsert.mock.calls[0][0] as Record<
        string,
        unknown
      >[];
      expect(insertedRows.every((r) => r.source_id === newSource.id)).toBe(true);

      // And: 기존 질문 3개에 대해 update/delete 등 변형 호출이 없다 (insert만 1회 호출됨)
      expect(supabaseMock.questionsInsert).toHaveBeenCalledTimes(1);
    });

    it("기존 미답변 질문 Q1(3일 전 생성)이 있으면, 새 배치를 저장해도 응답의 question은 새 질문이 아니라 Q1이다(FIFO 우선순위)", async () => {
      // Given
      const app = buildApp();
      const source = sourceRow();
      const threeDaysAgo = new Date(Date.parse(NOW_UTC) - 3 * 24 * 60 * 60 * 1000).toISOString();
      const q1 = {
        id: "q1-old-0000-4000-8000-000000000000",
        user_id: TEST_USER.id,
        source_id: source.id,
        category: "기존",
        text: "Q1",
        origin: "ai",
        created_at: threeDaysAgo,
        answers: [],
      };
      supabaseMock.sourcesResolve.mockResolvedValue({ data: [source], error: null });
      supabaseMock.questionsResolve.mockResolvedValueOnce({ data: [], error: null }); // 기존 질문 텍스트 조회(프롬프트용)
      supabaseMock.questionsResolve.mockResolvedValueOnce({ data: [q1], error: null }); // selectTodayQuestion: Q1이 가장 오래된 미답변

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({ sourceId: source.id });

      // Then
      expect(res.status).toBe(201);
      expect(res.body.question.id).toBe(q1.id);
      expect(res.body.question.text).toBe("Q1");
      expect(res.body.questions.some((q: { id: string }) => q.id === q1.id)).toBe(false);
    });
  });

  describe("sourceId 생략(v2, '다시 시도' 흐름) 시나리오", () => {
    it("sourceId 키 없이 요청하면 가장 최근 resume source(S2)를 findLatestResumeSourceId로 찾아 그 rawText로 생성하고, 저장되는 질문의 sourceId도 S2다", async () => {
      // Given: 오래된 S1과 최근 S2가 있다고 가정하되, "가장 최근 것을 고르는" 판단 자체는
      // findLatestResumeSourceId(질의 결과)의 몫이므로 이 mock은 그 최종 결과인 S2만
      // 반환하도록 구성한다.
      const app = buildApp();
      const s2 = sourceRow({ id: "s2-2222-4222-8222-222222222222", raw_text: "S2의 이력서 원문" });
      supabaseMock.sourcesResolve.mockResolvedValue({ data: [s2], error: null });
      supabaseMock.questionsResolve
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({ data: [], error: null });

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({});

      // Then
      expect(res.status).toBe(201);
      expect(res.body.questions).toBeDefined();
      expect(res.body.question).toBeDefined();
      const prompt = bedrockMock.generateInterviewQuestions.mock.calls[0][0] as string;
      expect(prompt).toContain("S2의 이력서 원문");
      const insertedRows = supabaseMock.questionsInsert.mock.calls[0][0] as Record<
        string,
        unknown
      >[];
      expect(insertedRows.every((r) => r.source_id === s2.id)).toBe(true);
    });

    it("resume source가 하나도 없으면 404 source_not_found를 받는다", async () => {
      // Given
      const app = buildApp();
      supabaseMock.sourcesResolve.mockResolvedValue({ data: [], error: null });

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({});

      // Then
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("source_not_found");
      expect(bedrockMock.generateInterviewQuestions).not.toHaveBeenCalled();
    });

    it("type='resume' source는 없고 type='notion' source만 있으면 findLatestResumeSourceId가 찾지 못해 404 source_not_found를 받는다", async () => {
      // Given: findLatestResumeSourceId는 type='resume'만 대상으로 하므로, notion만 있는
      // 상황은 "결과 없음"으로 관찰된다.
      const app = buildApp();
      supabaseMock.sourcesResolve.mockResolvedValue({ data: [], error: null });

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({});

      // Then
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("source_not_found");
    });

    it("sourceId가 빈 문자열이면 400 invalid_source_id를 받는다(빈 문자열은 '생략'으로 간주되지 않음)", async () => {
      // Given
      const app = buildApp();

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({ sourceId: "" });

      // Then
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_source_id");
      expect(bedrockMock.generateInterviewQuestions).not.toHaveBeenCalled();
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("sourceId가 문자열이 아니면(숫자) 400 invalid_source_id를 받는다", async () => {
      // Given
      const app = buildApp();

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({ sourceId: 12345 });

      // Then
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_source_id");
    });

    it("sourceId가 null이면 400 invalid_source_id를 받는다", async () => {
      // Given
      const app = buildApp();

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({ sourceId: null });

      // Then
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_source_id");
    });
  });

  describe("엣지 케이스", () => {
    it("Bedrock이 마크다운 코드펜스로 감싼 JSON을 반환해도 정상 파싱되어 201 응답을 받는다", async () => {
      // Given
      const app = buildApp();
      bedrockMock.generateInterviewQuestions.mockResolvedValue(
        fencedBedrockJson(validItems(REQUESTED_QUESTION_COUNT)),
      );

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({ sourceId: sourceRow().id });

      // Then
      expect(res.status).toBe(201);
      expect(res.body.questions).toHaveLength(15);
    });

    it("15개 항목 중 3개가 유효하지 않으면(category 빈 문자열, text 501자) 유효한 12개만 저장되고 201을 받는다", async () => {
      // Given
      const app = buildApp();
      const items = validItems(12);
      items.push(
        { category: "", text: "유효하지 않은 항목 1" },
        { category: "카테고리", text: "가".repeat(501) },
        { category: "  ", text: "유효하지 않은 항목 3" },
      );
      bedrockMock.generateInterviewQuestions.mockResolvedValue(bedrockJson(items));

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({ sourceId: sourceRow().id });

      // Then
      expect(res.status).toBe(201);
      expect(res.body.questions).toHaveLength(12);
    });

    it("완전히 동일한 text를 가진 항목 2개가 포함되면 중복 중 1개만 저장된다", async () => {
      // Given: 7개 중 마지막이 첫 번째와 완전히 동일한 text (유니크 6개)
      const app = buildApp();
      const items = validItems(7);
      items[6] = { ...items[0], category: "다른카테고리" };
      bedrockMock.generateInterviewQuestions.mockResolvedValue(bedrockJson(items));

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({ sourceId: sourceRow().id });

      // Then
      expect(res.status).toBe(201);
      expect(res.body.questions).toHaveLength(6);
    });

    it("Bedrock이 유효 항목 4개만 반환하면(MIN_VALID_QUESTIONS 미만) 500 generation_failed를 받고 어떤 row도 추가되지 않는다", async () => {
      // Given
      const app = buildApp();
      bedrockMock.generateInterviewQuestions.mockResolvedValue(bedrockJson(validItems(4)));

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({ sourceId: sourceRow().id });

      // Then
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("generation_failed");
      expect(supabaseMock.questionsInsert).not.toHaveBeenCalled();
    });

    it("정확히 MIN_VALID_QUESTIONS(5)개면 실패 없이 201로 성공 처리된다(경계값)", async () => {
      // Given
      const app = buildApp();
      bedrockMock.generateInterviewQuestions.mockResolvedValue(
        bedrockJson(validItems(MIN_VALID_QUESTIONS)),
      );

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({ sourceId: sourceRow().id });

      // Then
      expect(res.status).toBe(201);
      expect(res.body.questions).toHaveLength(5);
    });

    it("Bedrock이 유효 항목 35개를 반환하면(MAX_QUESTIONS_STORED 초과) 앞 30개까지만 저장된다", async () => {
      // Given
      const app = buildApp();
      bedrockMock.generateInterviewQuestions.mockResolvedValue(bedrockJson(validItems(35)));

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({ sourceId: sourceRow().id });

      // Then
      expect(res.status).toBe(201);
      expect(res.body.questions).toHaveLength(MAX_QUESTIONS_STORED);
      const insertedRows = supabaseMock.questionsInsert.mock.calls[0][0] as unknown[];
      expect(insertedRows).toHaveLength(MAX_QUESTIONS_STORED);
    });

    it("sourceId가 다른 사용자 소유의 source를 가리키면 404 source_not_found를 받는다", async () => {
      // Given: sources 조회 결과가 없음(user_id 불일치로 조회되지 않음을 이렇게 표현)
      const app = buildApp();
      supabaseMock.sourcesResolve.mockResolvedValue({ data: [], error: null });

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({ sourceId: "other-users-source-id-4444-8444-444444444444" });

      // Then
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("source_not_found");
      expect(bedrockMock.generateInterviewQuestions).not.toHaveBeenCalled();
    });

    it("sourceId가 존재하지 않는 UUID를 가리키면 404 source_not_found를 받는다", async () => {
      // Given
      const app = buildApp();
      supabaseMock.sourcesResolve.mockResolvedValue({ data: [], error: null });

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({ sourceId: "ffffffff-ffff-4fff-8fff-ffffffffffff" });

      // Then
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("source_not_found");
    });

    it("sourceId(명시적으로 전달됨)가 가리키는 source의 type이 notion이면 400 unsupported_source_type을 받는다", async () => {
      // Given
      const app = buildApp();
      const notionSource = sourceRow({
        id: "notion-source-0000-4000-8000-000000000000",
        type: "notion",
      });
      supabaseMock.sourcesResolve.mockResolvedValue({ data: [notionSource], error: null });

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({ sourceId: notionSource.id });

      // Then
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("unsupported_source_type");
      expect(bedrockMock.generateInterviewQuestions).not.toHaveBeenCalled();
    });
  });

  describe("에러 케이스", () => {
    it("인증 쿠키 없이 요청하면 401 unauthorized를 받고 이후 어떤 단계도 실행되지 않는다", async () => {
      // Given
      const app = buildApp();
      authMock.requireAuthenticatedUser.mockImplementation((_req: Request, res: Response) => {
        res.status(401).json({ error: "unauthorized", message: "인증되지 않은 요청입니다." });
      });

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .send({ sourceId: sourceRow().id });

      // Then
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("unauthorized");
      expect(supabaseMock.from).not.toHaveBeenCalled();
      expect(bedrockMock.generateInterviewQuestions).not.toHaveBeenCalled();
    });

    it("Bedrock 호출 자체가 예외(타임아웃 등)를 던지면 500 generation_failed를 받고 어떤 row도 추가되지 않는다", async () => {
      // Given
      const app = buildApp();
      bedrockMock.generateInterviewQuestions.mockRejectedValue(new Error("timeout"));

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({ sourceId: sourceRow().id });

      // Then
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("generation_failed");
      expect(supabaseMock.questionsInsert).not.toHaveBeenCalled();
    });

    it("파싱까지 성공했지만 questions insert가 실패(커넥션 오류)하면 500 internal_error를 받는다", async () => {
      // Given
      const app = buildApp();
      supabaseMock.questionsInsertResolve.mockResolvedValue({
        data: null,
        error: { message: "connection refused" },
      });

      // When
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "dic_visitor_email=visitor@example.com")
        .send({ sourceId: sourceRow().id });

      // Then
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("internal_error");
    });
  });
});

describe("GET /api/questions/today", () => {
  function unansweredRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "q-0000-4000-8000-000000000000",
      user_id: TEST_USER.id,
      source_id: sourceRow().id,
      category: "카테고리",
      text: "질문 텍스트",
      origin: "ai",
      created_at: NOW_UTC,
      answers: [],
      ...overrides,
    };
  }

  describe("정상 시나리오", () => {
    it("미답변 질문 3개(생성일 오름차순 Q1,Q2,Q3) 중 200 응답과 question=Q1을 받는다", async () => {
      // Given
      const app = buildApp();
      const q1 = unansweredRow({
        id: "q1-1111-4111-8111-111111111111",
        text: "Q1",
        created_at: "2026-08-01T00:00:00+00:00",
      });
      const q2 = unansweredRow({
        id: "q2-2222-4222-8222-222222222222",
        text: "Q2",
        created_at: "2026-08-02T00:00:00+00:00",
      });
      const q3 = unansweredRow({
        id: "q3-3333-4333-8333-333333333333",
        text: "Q3",
        created_at: "2026-08-03T00:00:00+00:00",
      });
      supabaseMock.questionsResolve
        .mockResolvedValueOnce({ data: [q1, q2, q3], error: null }) // selectTodayQuestion
        .mockResolvedValue({ data: [], error: null, count: 99 }); // prefetch count (트리거 안 함)

      // When
      const res = await request(app)
        .get("/api/questions/today")
        .set("Cookie", "dic_visitor_email=visitor@example.com");

      // Then
      expect(res.status).toBe(200);
      expect(res.body.question.id).toBe(q1.id);
      expect(res.body.question.text).toBe("Q1");
      expect(res.body.question.createdAt).toBe(toKst(q1.created_at as string));
    });

    it("Q1(답변 완료), Q2(미답변)가 있으면 question=Q2를 받는다", async () => {
      // Given
      const app = buildApp();
      const q1Answered = unansweredRow({
        id: "q1-answered-4111-8111-111111111111",
        text: "Q1",
        created_at: "2026-08-01T00:00:00+00:00",
        answers: [{ id: "answer-1" }],
      });
      const q2 = unansweredRow({
        id: "q2-2222-4222-8222-222222222222",
        text: "Q2",
        created_at: "2026-08-02T00:00:00+00:00",
        answers: [],
      });
      supabaseMock.questionsResolve
        .mockResolvedValueOnce({ data: [q1Answered, q2], error: null })
        .mockResolvedValue({ data: [], error: null, count: 99 });

      // When
      const res = await request(app)
        .get("/api/questions/today")
        .set("Cookie", "dic_visitor_email=visitor@example.com");

      // Then
      expect(res.status).toBe(200);
      expect(res.body.question.id).toBe(q2.id);
    });
  });

  describe("엣지 케이스", () => {
    it("questions row가 하나도 없으면 200과 question=null을 받는다", async () => {
      // Given
      const app = buildApp();
      supabaseMock.questionsResolve.mockResolvedValue({ data: [], error: null, count: 0 });
      supabaseMock.sourcesResolve.mockResolvedValue({ data: [], error: null }); // prefetch 시도해도 source 없음

      // When
      const res = await request(app)
        .get("/api/questions/today")
        .set("Cookie", "dic_visitor_email=visitor@example.com");

      // Then
      expect(res.status).toBe(200);
      expect(res.body.question).toBeNull();
    });

    it("모든 질문이 답변 완료 상태면 200과 question=null을 받는다", async () => {
      // Given
      const app = buildApp();
      const answered = unansweredRow({ answers: [{ id: "answer-1" }] });
      supabaseMock.questionsResolve
        .mockResolvedValueOnce({ data: [answered], error: null })
        .mockResolvedValue({ data: [], error: null, count: 0 });
      supabaseMock.sourcesResolve.mockResolvedValue({ data: [], error: null });

      // When
      const res = await request(app)
        .get("/api/questions/today")
        .set("Cookie", "dic_visitor_email=visitor@example.com");

      // Then
      expect(res.status).toBe(200);
      expect(res.body.question).toBeNull();
    });

    it("미답변 질문이 정확히 5개(PREFETCH_THRESHOLD)이고 resume source가 있으면, 200 응답을 즉시 받고(백그라운드 작업을 기다리지 않음) 이후 generateAndSaveQuestionBatch(Bedrock 호출)가 1회 트리거된다", async () => {
      // Given
      const app = buildApp();
      const rows = Array.from({ length: PREFETCH_THRESHOLD }, (_, i) =>
        unansweredRow({
          id: `q-${i}-0000-4000-8000-00000000000${i}`,
          text: `Q${i}`,
          created_at: new Date(Date.parse(NOW_UTC) + i * 1000).toISOString(),
        }),
      );
      supabaseMock.questionsResolve
        .mockResolvedValueOnce({ data: rows, error: null }) // selectTodayQuestion
        .mockResolvedValueOnce({ data: null, error: null, count: PREFETCH_THRESHOLD }); // prefetch count
      supabaseMock.sourcesResolve.mockResolvedValue({ data: [sourceRow()], error: null });

      // When
      const res = await request(app)
        .get("/api/questions/today")
        .set("Cookie", "dic_visitor_email=visitor@example.com");

      // Then: 응답은 즉시 정상적으로 온다
      expect(res.status).toBe(200);
      expect(res.body.question).not.toBeNull();

      // And: fire-and-forget으로 트리거된 재생성이 (비동기로) 실제로 시도된다
      await vi.waitFor(() => {
        expect(bedrockMock.generateInterviewQuestions).toHaveBeenCalledTimes(1);
      });
    });

    it("미답변 질문이 6개(PREFETCH_THRESHOLD 초과)면 재생성이 트리거되지 않는다", async () => {
      // Given
      const app = buildApp();
      const rows = Array.from({ length: 6 }, (_, i) =>
        unansweredRow({
          id: `q-${i}-0000-4000-8000-00000000000${i}`,
          created_at: new Date(Date.parse(NOW_UTC) + i * 1000).toISOString(),
        }),
      );
      supabaseMock.questionsResolve
        .mockResolvedValueOnce({ data: rows, error: null })
        .mockResolvedValueOnce({ data: null, error: null, count: 6 });

      // When
      const res = await request(app)
        .get("/api/questions/today")
        .set("Cookie", "dic_visitor_email=visitor@example.com");

      // Then
      expect(res.status).toBe(200);
      await new Promise((resolve) => setImmediate(resolve));
      expect(bedrockMock.generateInterviewQuestions).not.toHaveBeenCalled();
    });

    it("미답변 질문이 3개(임계치 이하)지만 source가 하나도 없으면, 정상 응답을 받고 재생성은 트리거되지 않으며 에러도 발생하지 않는다", async () => {
      // Given
      const app = buildApp();
      const rows = Array.from({ length: 3 }, (_, i) =>
        unansweredRow({
          id: `q-${i}-0000-4000-8000-00000000000${i}`,
          created_at: new Date(Date.parse(NOW_UTC) + i * 1000).toISOString(),
        }),
      );
      supabaseMock.questionsResolve
        .mockResolvedValueOnce({ data: rows, error: null })
        .mockResolvedValueOnce({ data: null, error: null, count: 3 });
      supabaseMock.sourcesResolve.mockResolvedValue({ data: [], error: null });

      // When
      const res = await request(app)
        .get("/api/questions/today")
        .set("Cookie", "dic_visitor_email=visitor@example.com");

      // Then
      expect(res.status).toBe(200);
      expect(res.body.question).not.toBeNull();
      await new Promise((resolve) => setImmediate(resolve));
      expect(bedrockMock.generateInterviewQuestions).not.toHaveBeenCalled();
    });
  });

  describe("에러 케이스", () => {
    it("인증 쿠키 없이 요청하면 401 unauthorized를 받는다", async () => {
      // Given
      const app = buildApp();
      authMock.requireAuthenticatedUser.mockImplementation((_req: Request, res: Response) => {
        res.status(401).json({ error: "unauthorized", message: "인증되지 않은 요청입니다." });
      });

      // When
      const res = await request(app).get("/api/questions/today");

      // Then
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("unauthorized");
    });

    it("DB 조회 자체가 실패(커넥션 오류)하면 500 internal_error를 받는다", async () => {
      // Given
      const app = buildApp();
      supabaseMock.questionsResolve.mockResolvedValue({
        data: null,
        error: { message: "connection refused" },
      });

      // When
      const res = await request(app)
        .get("/api/questions/today")
        .set("Cookie", "dic_visitor_email=visitor@example.com");

      // Then
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("internal_error");
    });
  });
});

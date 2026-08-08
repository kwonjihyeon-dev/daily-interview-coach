import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import authRouter from "./auth";
import { findSetCookie, parseSetCookie } from "../test-utils/setCookie";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md (v2)
 * "백엔드: POST /api/sessions (변경 — 쿠키 발급 추가)" 절.
 *
 * 이 파일은 `lookupUserByEmail` 헬퍼를 모킹해 auth 라우트 자체의 입력 검증 순서
 * (email_required → invalid_email_format → DB 조회)와 응답 바디/상태코드만 독립적으로
 * 검증한다. `lookupUserByEmail`의 내부 Supabase 조회 로직은 `lib/userLookup.test.ts`에서
 * 다룬다. app.ts에서의 라우트 등록/배선은 `app.test.ts`에서 별도로 검증한다(레거시
 * `requireApiKey`는 완전히 삭제되었으므로 더 이상 "먼저 등록되는지" 순서를 신경 쓸 필요가
 * 없다 — 아키텍처 결정 사항 #7).
 *
 * v2에서 추가된 것: (1) 엔드포인트가 `POST /api/auth/verify-email`에서 **`POST /api/sessions`**
 * 로 RESTful하게 재명명되었다("이메일 검증"이라는 동작 대신 "세션 생성"이라는 자원으로
 * 모델링, 아키텍처 결정 사항 #8) — 라우터 파일 경로(`routes/auth.ts`)와 내부 함수/변수명은
 * 그대로 유지, URL만 변경. (2) 성공 상태코드도 `200` → **`201 Created`**로 변경(다른
 * 생성 엔드포인트인 `/api/sources/resume`와 동일 컨벤션). 400/401/500 응답 바디/코드는 v1과
 * 완전히 동일. (3) 성공(201) 시 `res.cookie(...)`로 `Set-Cookie` 헤더가 발급되어야 한다
 * ("쿠키 명세" 절). 특히 `maxAge`는 Express 기준 밀리초 단위여야 하며, 초 단위를 그대로
 * 넘기면 `Max-Age` 헤더가 180초로 잘못 발급되는 버그가 생긴다는 점을 스펙이 명시적으로
 * 경고하므로, 실제 `Max-Age` 헤더 값(초 단위, 15552000)을 정확히 검증한다.
 *
 * `Set-Cookie` 헤더 파싱 로직은 `../test-utils/setCookie`에 공유 헬퍼로 응집시켰다 —
 * 향후 쿠키 발급/검증이 필요한 다른 테스트도 이를 재사용해 파싱 로직 중복/누락을 피한다.
 */

const userLookupMock = vi.hoisted(() => ({ lookupUserByEmail: vi.fn() }));
vi.mock("../lib/userLookup", () => userLookupMock);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/sessions", authRouter);
  return app;
}

function findVisitorSetCookie(res: {
  headers: Record<string, string | string[] | undefined>;
}): string | undefined {
  return findSetCookie(res, "dic_visitor_email");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/sessions", () => {
  describe("정상 시나리오", () => {
    it("users 테이블에 등록된 이메일이면 201과 { verified: true }만 반환한다(id 미노출)", async () => {
      // Given
      userLookupMock.lookupUserByEmail.mockResolvedValue({
        user: { id: "u1", email: "user@example.com" },
        isFailedQuery: false,
      });

      // When
      const res = await request(buildApp())
        .post("/api/sessions")
        .send({ email: "user@example.com" });

      // Then
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ verified: true });
      // 유저 id는 응답에 노출되지 않는다
      expect(Object.keys(res.body).sort()).toEqual(["verified"]);
      expect(userLookupMock.lookupUserByEmail).toHaveBeenCalledWith("user@example.com");
    });

    it("성공(201) 시 dic_visitor_email Set-Cookie 헤더를 name/httpOnly/sameSite/path/maxAge 정확히 발급한다(개발 환경: secure 없음)", async () => {
      // Given: 로컬/테스트 환경(NODE_ENV가 production이 아님)
      vi.stubEnv("NODE_ENV", "development");
      userLookupMock.lookupUserByEmail.mockResolvedValue({
        user: { id: "u1", email: "user@example.com" },
        isFailedQuery: false,
      });

      // When
      const res = await request(buildApp())
        .post("/api/sessions")
        .send({ email: "user@example.com" });

      // Then
      expect(res.status).toBe(201);
      const setCookie = findVisitorSetCookie(res);
      expect(setCookie).toBeDefined();
      const parsed = parseSetCookie(setCookie!);
      expect(parsed.name).toBe("dic_visitor_email");
      expect(parsed.value).toBe("user@example.com");
      expect(parsed.attributes.httponly).toBe(true);
      expect(String(parsed.attributes.samesite).toLowerCase()).toBe("lax");
      expect(parsed.attributes.path).toBe("/");
      // Express의 res.cookie maxAge는 밀리초 단위 — 15552000 * 1000을 넘겨야 아래
      // Max-Age 헤더(초 단위)가 180일(15552000초)로 정확히 나간다. 초 단위를 그대로
      // 넘기면 15552로 나가는 버그가 생긴다(스펙의 "단위 변환 주의" 경고).
      expect(parsed.attributes["max-age"]).toBe("15552000");
      expect(parsed.attributes.secure).toBeUndefined();
    });

    it("성공(201) 시 NODE_ENV=production이면 Set-Cookie 헤더에 secure 속성이 포함된다", async () => {
      // Given
      vi.stubEnv("NODE_ENV", "production");
      userLookupMock.lookupUserByEmail.mockResolvedValue({
        user: { id: "u1", email: "user@example.com" },
        isFailedQuery: false,
      });

      // When
      const res = await request(buildApp())
        .post("/api/sessions")
        .send({ email: "user@example.com" });

      // Then
      const setCookie = findVisitorSetCookie(res);
      expect(setCookie).toBeDefined();
      const parsed = parseSetCookie(setCookie!);
      expect(parsed.attributes.secure).toBe(true);
    });
  });

  describe("엣지 케이스", () => {
    it("대소문자/앞뒤 공백이 섞인 이메일도 trim+lowercase 정규화 후 대조한다", async () => {
      // Given
      userLookupMock.lookupUserByEmail.mockResolvedValue({
        user: { id: "u1", email: "user@example.com" },
        isFailedQuery: false,
      });

      // When
      const res = await request(buildApp())
        .post("/api/sessions")
        .send({ email: " User@Example.com " });

      // Then
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ verified: true });
      expect(userLookupMock.lookupUserByEmail).toHaveBeenCalledWith("user@example.com");
    });

    it("대소문자/앞뒤 공백이 섞인 이메일로 성공해도 쿠키 값은 정규화된(trim+lowercase) 이메일이다", async () => {
      // Given
      userLookupMock.lookupUserByEmail.mockResolvedValue({
        user: { id: "u1", email: "user@example.com" },
        isFailedQuery: false,
      });

      // When
      const res = await request(buildApp())
        .post("/api/sessions")
        .send({ email: " User@Example.com " });

      // Then
      const setCookie = findVisitorSetCookie(res);
      expect(setCookie).toBeDefined();
      expect(parseSetCookie(setCookie!).value).toBe("user@example.com");
    });

    it("email 필드 자체가 없으면 400 email_required를 반환하고 DB를 조회하지 않는다", async () => {
      // Given / When: 비정상 클라이언트의 직접 호출 등
      const res = await request(buildApp()).post("/api/sessions").send({});

      // Then
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "email_required", message: "이메일을 입력해주세요." });
      expect(userLookupMock.lookupUserByEmail).not.toHaveBeenCalled();
    });

    it("공백만 입력하면 400 email_required를 반환한다", async () => {
      // Given / When
      const res = await request(buildApp())
        .post("/api/sessions")
        .send({ email: "   " });

      // Then
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "email_required", message: "이메일을 입력해주세요." });
      expect(userLookupMock.lookupUserByEmail).not.toHaveBeenCalled();
    });

    it("이메일 형식이 아니면 400 invalid_email_format을 반환하고 DB를 조회하지 않는다", async () => {
      // Given / When
      const res = await request(buildApp())
        .post("/api/sessions")
        .send({ email: "not-an-email" });

      // Then
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: "invalid_email_format",
        message: "올바른 이메일 형식이 아닙니다.",
      });
      expect(userLookupMock.lookupUserByEmail).not.toHaveBeenCalled();
    });

    it("정규화 후 길이가 254자를 초과하면 형식은 이메일이어도 400 invalid_email_format을 반환한다", async () => {
      // Given: 254자를 초과하는 이메일(경계값 초과)
      const email = `${"a".repeat(250)}@a.co`;
      expect(email.length).toBeGreaterThan(254);

      // When
      const res = await request(buildApp()).post("/api/sessions").send({ email });

      // Then
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_email_format");
      expect(userLookupMock.lookupUserByEmail).not.toHaveBeenCalled();
    });

    it("잘못된 이메일로 여러 번 연속 실패해도 재시도 횟수 제한 없이 이후 올바른 이메일은 정상 처리된다", async () => {
      // Given: 3회 연속 형식 오류 실패
      const app = buildApp();
      for (let i = 0; i < 3; i += 1) {
        const failRes = await request(app)
          .post("/api/sessions")
          .send({ email: "not-an-email" });
        expect(failRes.status).toBe(400);
      }
      userLookupMock.lookupUserByEmail.mockResolvedValue({
        user: { id: "u1", email: "user@example.com" },
        isFailedQuery: false,
      });

      // When: 네 번째 시도에 올바른 이메일 제출
      const res = await request(app)
        .post("/api/sessions")
        .send({ email: "user@example.com" });

      // Then: 잠금·쿨다운 없이 정상 성공
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ verified: true });
    });
  });

  describe("에러 케이스", () => {
    it("users 테이블에 없는 이메일이면 401 email_not_found를 반환한다", async () => {
      // Given
      userLookupMock.lookupUserByEmail.mockResolvedValue({ user: null, isFailedQuery: false });

      // When
      const res = await request(buildApp())
        .post("/api/sessions")
        .send({ email: "nobody@example.com" });

      // Then
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: "email_not_found",
        message: "등록되지 않은 이메일입니다. 접근 권한이 있는 이메일인지 확인해주세요.",
      });
      expect(findVisitorSetCookie(res)).toBeUndefined();
    });

    it("DB 조회 자체가 실패하면(isFailedQuery=true) 500 internal_error를 반환하고 email_not_found로 오분류하지 않는다", async () => {
      // Given: Supabase 커넥션 오류로 조회 자체가 실패
      userLookupMock.lookupUserByEmail.mockResolvedValue({ user: null, isFailedQuery: true });

      // When
      const res = await request(buildApp())
        .post("/api/sessions")
        .send({ email: "user@example.com" });

      // Then
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: "internal_error",
        message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      });
      expect(findVisitorSetCookie(res)).toBeUndefined();
    });

    it("email_required(400)로 실패하면 쿠키를 발급하지 않는다", async () => {
      // Given / When
      const res = await request(buildApp()).post("/api/sessions").send({});

      // Then
      expect(res.status).toBe(400);
      expect(findVisitorSetCookie(res)).toBeUndefined();
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import authRouter from "./auth";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md
 * "백엔드 보강: POST /api/auth/verify-email" 절.
 *
 * 이 파일은 `lookupUserByEmail` 헬퍼를 모킹해 auth 라우트 자체의 입력 검증 순서
 * (email_required → invalid_email_format → DB 조회)와 응답 바디/상태코드만 독립적으로
 * 검증한다. `lookupUserByEmail`의 내부 Supabase 조회 로직은 `lib/userLookup.test.ts`에서
 * 다룬다. app.ts에서의 라우팅 순서(requireApiKey보다 먼저 등록되는지)는 `app.test.ts`에서
 * 별도로 검증한다.
 */

const userLookupMock = vi.hoisted(() => ({ lookupUserByEmail: vi.fn() }));
vi.mock("../lib/userLookup", () => userLookupMock);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth/verify-email", authRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/verify-email", () => {
  describe("정상 시나리오", () => {
    it("users 테이블에 등록된 이메일이면 200과 { verified: true }만 반환한다(id 미노출)", async () => {
      // Given
      userLookupMock.lookupUserByEmail.mockResolvedValue({
        user: { id: "u1", email: "user@example.com" },
        queryFailed: false,
      });

      // When
      const res = await request(buildApp())
        .post("/api/auth/verify-email")
        .send({ email: "user@example.com" });

      // Then
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ verified: true });
      // 유저 id는 응답에 노출되지 않는다
      expect(Object.keys(res.body).sort()).toEqual(["verified"]);
      expect(userLookupMock.lookupUserByEmail).toHaveBeenCalledWith("user@example.com");
    });
  });

  describe("엣지 케이스", () => {
    it("대소문자/앞뒤 공백이 섞인 이메일도 trim+lowercase 정규화 후 대조한다", async () => {
      // Given
      userLookupMock.lookupUserByEmail.mockResolvedValue({
        user: { id: "u1", email: "user@example.com" },
        queryFailed: false,
      });

      // When
      const res = await request(buildApp())
        .post("/api/auth/verify-email")
        .send({ email: " User@Example.com " });

      // Then
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ verified: true });
      expect(userLookupMock.lookupUserByEmail).toHaveBeenCalledWith("user@example.com");
    });

    it("email 필드 자체가 없으면 400 email_required를 반환하고 DB를 조회하지 않는다", async () => {
      // Given / When: 비정상 클라이언트의 직접 호출 등
      const res = await request(buildApp()).post("/api/auth/verify-email").send({});

      // Then
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "email_required", message: "이메일을 입력해주세요." });
      expect(userLookupMock.lookupUserByEmail).not.toHaveBeenCalled();
    });

    it("공백만 입력하면 400 email_required를 반환한다", async () => {
      // Given / When
      const res = await request(buildApp())
        .post("/api/auth/verify-email")
        .send({ email: "   " });

      // Then
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "email_required", message: "이메일을 입력해주세요." });
      expect(userLookupMock.lookupUserByEmail).not.toHaveBeenCalled();
    });

    it("이메일 형식이 아니면 400 invalid_email_format을 반환하고 DB를 조회하지 않는다", async () => {
      // Given / When
      const res = await request(buildApp())
        .post("/api/auth/verify-email")
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
      const res = await request(buildApp()).post("/api/auth/verify-email").send({ email });

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
          .post("/api/auth/verify-email")
          .send({ email: "not-an-email" });
        expect(failRes.status).toBe(400);
      }
      userLookupMock.lookupUserByEmail.mockResolvedValue({
        user: { id: "u1", email: "user@example.com" },
        queryFailed: false,
      });

      // When: 네 번째 시도에 올바른 이메일 제출
      const res = await request(app)
        .post("/api/auth/verify-email")
        .send({ email: "user@example.com" });

      // Then: 잠금·쿨다운 없이 정상 성공
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ verified: true });
    });
  });

  describe("에러 케이스", () => {
    it("users 테이블에 없는 이메일이면 401 email_not_found를 반환한다", async () => {
      // Given
      userLookupMock.lookupUserByEmail.mockResolvedValue({ user: null, queryFailed: false });

      // When
      const res = await request(buildApp())
        .post("/api/auth/verify-email")
        .send({ email: "nobody@example.com" });

      // Then
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: "email_not_found",
        message: "등록되지 않은 이메일입니다. 접근 권한이 있는 이메일인지 확인해주세요.",
      });
    });

    it("DB 조회 자체가 실패하면(queryFailed=true) 500 internal_error를 반환하고 email_not_found로 오분류하지 않는다", async () => {
      // Given: Supabase 커넥션 오류로 조회 자체가 실패
      userLookupMock.lookupUserByEmail.mockResolvedValue({ user: null, queryFailed: true });

      // When
      const res = await request(buildApp())
        .post("/api/auth/verify-email")
        .send({ email: "user@example.com" });

      // Then
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: "internal_error",
        message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      });
    });
  });
});

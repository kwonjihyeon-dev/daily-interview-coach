import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { requireAuthenticatedUser } from "./requireAuthenticatedUser";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md
 * "공유 헬퍼" 절: `requireAuthenticatedUser`는 내부 쿼리를 `lookupUserByEmail`로
 * 교체하되, 외부에서 관찰되는 동작(401/`unauthorized`)은 절대 바뀌지 않아야 한다.
 *
 * 특히 `queryFailed: true`(DB 조회 자체 실패)인 경우에도 `/api/auth/verify-email`과
 * 달리 500이 아닌 기존과 동일한 401 unauthorized로 응답해야 한다 — 이 특성 테스트가
 * 리팩터링 전후 동작 동등성을 보장하는 핵심 근거다.
 *
 * 이 미들웨어를 사용하는 `apps/api/src/routes/resume.ts`의 `resume.test.ts`는 이 미들웨어
 * 자체를 통째로 모킹하므로 겹치지 않는다(이 파일이 유일한 단위 테스트).
 */

const userLookupMock = vi.hoisted(() => ({ lookupUserByEmail: vi.fn() }));
vi.mock("../lib/userLookup", () => userLookupMock);

type MockUser = { id: string; email: string };

function buildApp() {
  const app = express();
  app.get(
    "/protected",
    requireAuthenticatedUser,
    (req: express.Request & { user?: MockUser }, res: express.Response) => {
      res.json({ user: req.user });
    },
  );
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireAuthenticatedUser", () => {
  describe("정상 시나리오", () => {
    it("lookupUserByEmail이 일치하는 user를 반환하면 req.user를 설정하고 다음 핸들러로 진행한다", async () => {
      // Given
      userLookupMock.lookupUserByEmail.mockResolvedValue({
        user: { id: "u1", email: "user@example.com" },
        queryFailed: false,
      });

      // When
      const res = await request(buildApp())
        .get("/protected")
        .set("x-user-email", "user@example.com");

      // Then
      expect(res.status).toBe(200);
      expect(res.body.user).toEqual({ id: "u1", email: "user@example.com" });
      expect(userLookupMock.lookupUserByEmail).toHaveBeenCalledWith("user@example.com");
    });
  });

  describe("에러 케이스", () => {
    it("x-user-email 헤더가 없으면 401 unauthorized를 반환하고 lookupUserByEmail을 호출하지 않는다", async () => {
      // Given / When
      const res = await request(buildApp()).get("/protected");

      // Then
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "unauthorized", message: "인증되지 않은 요청입니다." });
      expect(userLookupMock.lookupUserByEmail).not.toHaveBeenCalled();
    });

    it("lookupUserByEmail이 user=null(0건)을 반환하면 401 unauthorized를 반환한다", async () => {
      // Given
      userLookupMock.lookupUserByEmail.mockResolvedValue({ user: null, queryFailed: false });

      // When
      const res = await request(buildApp())
        .get("/protected")
        .set("x-user-email", "unknown@example.com");

      // Then
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "unauthorized", message: "인증되지 않은 요청입니다." });
    });

    it("lookupUserByEmail이 queryFailed=true(DB 조회 실패)를 반환해도 500이 아닌 기존과 동일한 401 unauthorized를 반환한다", async () => {
      // Given: DB 커넥션 오류 등으로 조회 자체가 실패
      userLookupMock.lookupUserByEmail.mockResolvedValue({ user: null, queryFailed: true });

      // When
      const res = await request(buildApp())
        .get("/protected")
        .set("x-user-email", "user@example.com");

      // Then: /api/auth/verify-email과 달리 여기서는 500으로 분기하지 않는다(기존 동작 유지)
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "unauthorized", message: "인증되지 않은 요청입니다." });
    });
  });
});

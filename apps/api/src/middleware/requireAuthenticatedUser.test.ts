import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { requireAuthenticatedUser } from "./requireAuthenticatedUser";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md
 * "백엔드: requireAuthenticatedUser (변경 — 쿠키 파싱)" 절.
 *
 * v2 재설계로 `x-user-email` 헤더 대신 `Cookie: dic_visitor_email=...`를 읽도록
 * 전면 재작성한다(헤더 지원은 하위호환 없이 완전히 제거됨 — 스펙 결정 #4).
 * `req.cookies`는 `cookie-parser`가 채우므로, 이 미들웨어를 격리 단위 테스트하려면
 * 이 파일의 로컬 Express 앱에도 동일하게 `cookieParser()`를 등록해야 한다
 * (app.ts 전역 등록은 이 테스트의 관심사가 아니다 — app.ts 배선은 app.test.ts가 담당).
 *
 * 내부 쿼리는 여전히 `lookupUserByEmail`로 위임하며, 외부에서 관찰되는 동작
 * (401/`unauthorized`, `isFailedQuery: true`도 500이 아닌 401)은 v1과 완전히 동일해야
 * 한다 — 값의 출처(헤더→쿠키)만 바뀐다.
 *
 * 이 미들웨어를 사용하는 `apps/api/src/routes/resume.ts`의 `resume.test.ts`는 이 미들웨어
 * 자체를 통째로 모킹하므로 겹치지 않는다(이 파일이 유일한 단위 테스트).
 */

const userLookupMock = vi.hoisted(() => ({ lookupUserByEmail: vi.fn() }));
vi.mock("../lib/userLookup", () => userLookupMock);

type MockUser = { id: string; email: string };

function buildApp() {
  const app = express();
  app.use(cookieParser());
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
    it("dic_visitor_email 쿠키 값과 일치하는 user를 lookupUserByEmail이 반환하면 req.user를 설정하고 다음 핸들러로 진행한다", async () => {
      // Given
      userLookupMock.lookupUserByEmail.mockResolvedValue({
        user: { id: "u1", email: "user@example.com" },
        isFailedQuery: false,
      });

      // When
      const res = await request(buildApp())
        .get("/protected")
        .set("Cookie", "dic_visitor_email=user@example.com");

      // Then
      expect(res.status).toBe(200);
      expect(res.body.user).toEqual({ id: "u1", email: "user@example.com" });
      expect(userLookupMock.lookupUserByEmail).toHaveBeenCalledWith("user@example.com");
    });
  });

  describe("엣지 케이스", () => {
    it("Cookie 헤더에 dic_visitor_email이 아닌 다른 쿠키만 있으면 401 unauthorized를 반환하고 lookupUserByEmail을 호출하지 않는다", async () => {
      // Given / When
      const res = await request(buildApp()).get("/protected").set("Cookie", "other=1");

      // Then
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "unauthorized", message: "인증되지 않은 요청입니다." });
      expect(userLookupMock.lookupUserByEmail).not.toHaveBeenCalled();
    });

    it("dic_visitor_email 쿠키 값이 빈 문자열이면 헤더/쿠키 부재와 동일하게 401 unauthorized를 반환하고 lookupUserByEmail을 호출하지 않는다", async () => {
      // Given / When: Cookie: dic_visitor_email=
      const res = await request(buildApp())
        .get("/protected")
        .set("Cookie", "dic_visitor_email=");

      // Then
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "unauthorized", message: "인증되지 않은 요청입니다." });
      expect(userLookupMock.lookupUserByEmail).not.toHaveBeenCalled();
    });
  });

  describe("에러 케이스", () => {
    it("Cookie 헤더 자체가 없으면 401 unauthorized를 반환하고 lookupUserByEmail을 호출하지 않는다", async () => {
      // Given / When
      const res = await request(buildApp()).get("/protected");

      // Then
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "unauthorized", message: "인증되지 않은 요청입니다." });
      expect(userLookupMock.lookupUserByEmail).not.toHaveBeenCalled();
    });

    it("x-user-email 헤더만 있고 Cookie가 없으면 401 unauthorized를 반환한다(하위호환 없음 — 헤더는 더 이상 확인하지 않는다)", async () => {
      // Given / When: v1 방식(헤더)으로만 인증을 시도하는 낡은 클라이언트를 가정
      const res = await request(buildApp())
        .get("/protected")
        .set("x-user-email", "user@example.com");

      // Then
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "unauthorized", message: "인증되지 않은 요청입니다." });
      expect(userLookupMock.lookupUserByEmail).not.toHaveBeenCalled();
    });

    it("lookupUserByEmail이 user=null(0건)을 반환하면 401 unauthorized를 반환한다", async () => {
      // Given
      userLookupMock.lookupUserByEmail.mockResolvedValue({ user: null, isFailedQuery: false });

      // When
      const res = await request(buildApp())
        .get("/protected")
        .set("Cookie", "dic_visitor_email=unknown@example.com");

      // Then
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "unauthorized", message: "인증되지 않은 요청입니다." });
    });

    it("lookupUserByEmail이 isFailedQuery=true(DB 조회 실패)를 반환해도 500이 아닌 기존과 동일한 401 unauthorized를 반환한다", async () => {
      // Given: DB 커넥션 오류 등으로 조회 자체가 실패
      userLookupMock.lookupUserByEmail.mockResolvedValue({ user: null, isFailedQuery: true });

      // When
      const res = await request(buildApp())
        .get("/protected")
        .set("Cookie", "dic_visitor_email=user@example.com");

      // Then: /api/auth/verify-email과 달리 여기서는 500으로 분기하지 않는다(기존 동작 유지)
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "unauthorized", message: "인증되지 않은 요청입니다." });
    });
  });
});

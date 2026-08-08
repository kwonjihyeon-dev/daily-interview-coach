import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md
 * "라우팅 순서" 절: `app.use("/api/auth/verify-email", authRouter)`는
 * `app.use("/api", requireApiKey)` **이전**에 등록되어야 한다.
 *
 * 이 파일은 app.ts의 "배선(라우트 등록 순서)"만 검증한다. `/api/auth/verify-email`의
 * 입력 검증/응답 바디 상세는 `routes/auth.test.ts`에서, `/api/sources/resume`의 업로드
 * 로직 상세는 기존 `routes/resume.test.ts`(수정하지 않음, 21개 테스트 계속 통과 유지)에서
 * 다룬다.
 */

const userLookupMock = vi.hoisted(() => ({ lookupUserByEmail: vi.fn() }));
vi.mock("./lib/userLookup", () => userLookupMock);

import app from "./app";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("app.ts 라우팅 순서", () => {
  it("POST /api/auth/verify-email은 x-api-key 헤더 없이도 도달 가능하다 (requireApiKey보다 먼저 등록됨)", async () => {
    // Given
    userLookupMock.lookupUserByEmail.mockResolvedValue({
      user: { id: "u1", email: "user@example.com" },
      queryFailed: false,
    });

    // When: x-api-key 헤더를 전혀 보내지 않는다
    const res = await request(app)
      .post("/api/auth/verify-email")
      .send({ email: "user@example.com" });

    // Then: requireApiKey에 막히지 않고 실제 검증 로직까지 도달한다
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ verified: true });
  });

  it("기존 /api/questions/today는 x-api-key 헤더가 없으면 여전히 401 unauthorized를 반환한다 (회귀 방지)", async () => {
    // Given / When
    const res = await request(app).get("/api/questions/today");

    // Then: 이번 기능 추가로 기존 API 키 인증 경로가 깨지지 않는다
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("/api/sources/resume는 x-api-key 없이도 도달하지만, x-user-email 헤더가 없으면 401 unauthorized를 반환한다 (기존 배치 유지)", async () => {
    // Given / When: x-api-key도, x-user-email도 없이 요청
    const res = await request(app).post("/api/sources/resume");

    // Then: requireApiKey가 아니라 requireAuthenticatedUser에 의해 401이 발생한다
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
    // 헤더가 없으므로 lookupUserByEmail까지 호출되지 않는다(기존 미들웨어 동작)
    expect(userLookupMock.lookupUserByEmail).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md (v2)
 * "아키텍처 결정 사항" #7(레거시 `requireApiKey` 완전 제거) + #8(엔드포인트 RESTful 재명명,
 * `/api/auth/verify-email` → `/api/sessions`) + "CORS 설정(apps/api, 신규)" 절.
 *
 * 이 파일은 app.ts의 "배선(라우트 등록, 전역 미들웨어 등록)"만 검증한다.
 * `/api/sessions`의 입력 검증/응답 바디/Set-Cookie 상세는 `routes/auth.test.ts`에서,
 * `requireAuthenticatedUser`의 쿠키 파싱 상세는 `middleware/requireAuthenticatedUser.test.ts`에서,
 * `/api/sources/resume`의 업로드 로직 상세는 기존 `routes/resume.test.ts`(수정하지 않음,
 * 21개 테스트 계속 통과 유지)에서 다룬다.
 *
 * v1 대비 변경점:
 * - "x-user-email 헤더가 없으면 401" 테스트는 v2에서 헤더 지원이 완전히 제거되므로
 *   "Cookie 헤더가 없으면 401"로 대체한다(하위호환 없음 — 스펙 결정 #4).
 * - 레거시 `requireApiKey`(고정 `x-api-key`)가 **완전히 삭제**되므로, "requireApiKey보다
 *   먼저 등록되는지" 같은 순서 검증은 더 이상 의미가 없다. `/api/questions/today`도
 *   `requireAuthenticatedUser`(쿠키 기반)로 전환되어 `/api/*` 전체가 인증 방식 하나로
 *   통일된다(스펙 결정 #7) — 이 파일의 라우팅 테스트는 이제 "쿠키 유무에 따른 200/401"만
 *   검증한다.
 * - 게이트 엔드포인트가 `POST /api/auth/verify-email` → `POST /api/sessions`로 RESTful하게
 *   재명명되고 성공 상태코드도 `200` → `201`로 바뀐다(스펙 결정 #8).
 */

const userLookupMock = vi.hoisted(() => ({ lookupUserByEmail: vi.fn() }));
vi.mock("./lib/userLookup", () => userLookupMock);

import app from "./app";

const ALLOWED_ORIGIN = "http://localhost:3000";
const VALID_COOKIE = "dic_visitor_email=user@example.com";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("app.ts 라우트 배선", () => {
  it("POST /api/sessions는 인증(쿠키) 없이도 도달 가능하다(게이트 엔드포인트 자체는 정의상 미인증)", async () => {
    // Given
    userLookupMock.lookupUserByEmail.mockResolvedValue({
      user: { id: "u1", email: "user@example.com" },
      isFailedQuery: false,
    });

    // When: 쿠키도, x-api-key 헤더도 전혀 보내지 않는다
    const res = await request(app)
      .post("/api/sessions")
      .send({ email: "user@example.com" });

    // Then: 실제 검증 로직까지 도달해 201로 응답한다(v1의 `/api/auth/verify-email` + 200에서 변경)
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ verified: true });
  });

  it("게이트 쿠키가 없으면 GET /api/questions/today는 401 unauthorized를 반환한다(레거시 x-api-key 기준에서 쿠키 기준으로 통일됨)", async () => {
    // Given / When: x-api-key도 보내지 않고(레거시라 이제 검사 자체가 없음), 쿠키도 없음
    const res = await request(app).get("/api/questions/today");

    // Then: requireApiKey는 완전히 삭제되었으므로, 이 401은 이제 "쿠키 부재"가 이유다
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
    expect(userLookupMock.lookupUserByEmail).not.toHaveBeenCalled();
  });

  it("유효한 게이트 쿠키가 있으면 x-api-key 헤더 없이도 GET /api/questions/today가 200을 반환한다(requireApiKey 완전 삭제 이후)", async () => {
    // Given
    userLookupMock.lookupUserByEmail.mockResolvedValue({
      user: { id: "u1", email: "user@example.com" },
      isFailedQuery: false,
    });

    // When: x-api-key 헤더는 전혀 보내지 않고, 유효한 게이트 쿠키만 보낸다
    const res = await request(app).get("/api/questions/today").set("Cookie", VALID_COOKIE);

    // Then
    expect(res.status).toBe(200);
    expect(userLookupMock.lookupUserByEmail).toHaveBeenCalledWith("user@example.com");
  });

  it("/api/sources/resume는 Cookie 헤더가 없으면 401 unauthorized를 반환한다(변경 없음 — 이미 requireAuthenticatedUser를 직접 체이닝하는 패턴이었음)", async () => {
    // Given / When: Cookie 없이 요청
    const res = await request(app).post("/api/sources/resume");

    // Then
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
    // 쿠키가 없으므로 lookupUserByEmail까지 호출되지 않는다(기존 미들웨어 동작, 값의 출처만 변경)
    expect(userLookupMock.lookupUserByEmail).not.toHaveBeenCalled();
  });
});

describe("app.ts CORS 정책", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("정상 시나리오", () => {
    it("ALLOWED_ORIGINS에 포함된 Origin으로 요청하면 Access-Control-Allow-Origin과 Access-Control-Allow-Credentials 헤더가 응답에 포함된다", async () => {
      // Given
      vi.stubEnv("ALLOWED_ORIGINS", ALLOWED_ORIGIN);

      // When: 인증 여부와 무관하게 CORS 헤더는 라우팅 이전 전역 미들웨어가 부여한다
      const res = await request(app)
        .get("/api/questions/today")
        .set("Origin", ALLOWED_ORIGIN);

      // Then
      expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });

    it("쉼표로 구분된 여러 ALLOWED_ORIGINS 중 하나와 일치하면 허용한다(앞뒤 공백 trim)", async () => {
      // Given
      vi.stubEnv("ALLOWED_ORIGINS", " http://localhost:3000 , https://app.example.com ");

      // When
      const res = await request(app)
        .get("/api/questions/today")
        .set("Origin", "https://app.example.com");

      // Then
      expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    });
  });

  describe("엣지 케이스", () => {
    it("Origin 헤더가 없는 비브라우저 호출(curl 등)은 CORS와 무관하게 정상 처리된다", async () => {
      // Given
      vi.stubEnv("ALLOWED_ORIGINS", ALLOWED_ORIGIN);

      // When: Origin 헤더 자체를 보내지 않음
      const res = await request(app).get("/api/questions/today");

      // Then: 게이트 쿠키 부재로 인한 401은 CORS와 무관하게 그대로 발생 — 차단되지 않고
      // 정상 처리됐다는 뜻(레거시 x-api-key는 이제 검사 자체가 없음)
      expect(res.status).toBe(401);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("ALLOWED_ORIGINS가 미설정이면(fail-closed) 모든 브라우저발 Origin 요청에 CORS 헤더를 부여하지 않는다", async () => {
      // Given: ALLOWED_ORIGINS를 설정하지 않음(빈 목록)
      vi.stubEnv("ALLOWED_ORIGINS", "");

      // When
      const res = await request(app)
        .get("/api/questions/today")
        .set("Origin", ALLOWED_ORIGIN);

      // Then: 요청 자체는 내부적으로 정상 처리되나(여기서는 쿠키 부재로 401) CORS 헤더가
      // 없어 브라우저가 차단한다
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  describe("에러 케이스", () => {
    it("허용 목록에 없는 Origin으로 요청하면 500 에러가 아니라 CORS 헤더 생략으로 처리된다", async () => {
      // Given
      vi.stubEnv("ALLOWED_ORIGINS", ALLOWED_ORIGIN);

      // When
      const res = await request(app)
        .get("/api/questions/today")
        .set("Origin", "https://evil.com");

      // Then: 요청 자체는 여전히 401(쿠키 부재로 정상 처리)이며 500이 아니다
      expect(res.status).toBe(401);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("허용되지 않는 Origin에서 POST /api/sessions을 호출해도(요청 자체는 처리되지만) CORS 헤더가 없어 브라우저가 응답을 읽지 못한다", async () => {
      // Given
      vi.stubEnv("ALLOWED_ORIGINS", ALLOWED_ORIGIN);
      userLookupMock.lookupUserByEmail.mockResolvedValue({
        user: { id: "u1", email: "user@example.com" },
        isFailedQuery: false,
      });

      // When
      const res = await request(app)
        .post("/api/sessions")
        .set("Origin", "https://evil.com")
        .send({ email: "user@example.com" });

      // Then: apps/api 내부적으로는 201로 정상 처리되지만 CORS 헤더가 없다
      expect(res.status).toBe(201);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });
});

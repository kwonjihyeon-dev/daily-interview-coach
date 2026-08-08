import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md
 *
 * `lookupUserByEmail`은 `requireAuthenticatedUser`와 신규 `POST /api/auth/verify-email`이
 * 공유하는 헬퍼다. "DB 조회 자체가 실패(커넥션 오류 등)"와 "조회는 성공했지만 결과 0건"을
 * 반드시 구분해야 한다 — 전자는 `queryFailed: true`, 후자는 `user: null, queryFailed: false`.
 *
 * Supabase `.maybeSingle()`을 사용한다고 가정한다: 0건일 때 `{ data: null, error: null }`,
 * 커넥션 오류 등 실제 실패 시에는 `{ data: null, error: {...} }`를 반환하는 것이
 * `.single()`과 달리 별도의 에러 코드 분기 없이도 두 상황을 자연스럽게 구분해준다.
 */

const supabaseMock = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { maybeSingle, eq, select, from };
});
vi.mock("./supabaseClient", () => ({ supabase: { from: supabaseMock.from } }));

import { lookupUserByEmail } from "./userLookup";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lookupUserByEmail", () => {
  describe("정상 시나리오", () => {
    it("일치하는 row가 있으면 { user, queryFailed: false }를 반환한다", async () => {
      // Given
      supabaseMock.maybeSingle.mockResolvedValue({
        data: { id: "u1", email: "user@example.com" },
        error: null,
      });

      // When
      const result = await lookupUserByEmail("user@example.com");

      // Then
      expect(result).toEqual({
        user: { id: "u1", email: "user@example.com" },
        queryFailed: false,
      });
      expect(supabaseMock.from).toHaveBeenCalledWith("users");
      expect(supabaseMock.select).toHaveBeenCalledWith("id, email");
      expect(supabaseMock.eq).toHaveBeenCalledWith("email", "user@example.com");
    });
  });

  describe("엣지 케이스", () => {
    it("일치하는 row가 없으면(0건) { user: null, queryFailed: false }를 반환한다", async () => {
      // Given: 조회는 성공했지만 결과가 없는 상태(.maybeSingle()의 정상적인 0건 응답)
      supabaseMock.maybeSingle.mockResolvedValue({ data: null, error: null });

      // When
      const result = await lookupUserByEmail("nobody@example.com");

      // Then
      expect(result).toEqual({ user: null, queryFailed: false });
    });
  });

  describe("에러 케이스", () => {
    it("조회 자체가 실패하면(커넥션 오류 등) { user: null, queryFailed: true }를 반환한다", async () => {
      // Given: 커넥션 오류로 조회 자체가 실패
      supabaseMock.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: "connection refused", code: "57P03" },
      });

      // When
      const result = await lookupUserByEmail("user@example.com");

      // Then: 0건(email_not_found)과 절대 혼동되지 않아야 한다
      expect(result).toEqual({ user: null, queryFailed: true });
    });
  });
});

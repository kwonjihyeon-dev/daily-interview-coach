import { supabase } from "./supabaseClient";

/**
 * 이메일 기반 방문자 게이트(PRD 3.7) 공유 조회 헬퍼.
 *
 * `requireAuthenticatedUser`(기존 인증 미들웨어)와 신규 `POST /api/auth/verify-email`이
 * 함께 사용한다. "DB 조회 자체가 실패(커넥션 오류 등)"와 "조회는 성공했지만 결과 0건"을
 * 명확히 구분해야 두 호출자가 각자 다른 상태코드(500 vs 401)로 응답할 수 있다.
 */

export interface LookupUserResult {
  user: { id: string; email: string } | null;
  queryFailed: boolean;
}

export async function lookupUserByEmail(email: string): Promise<LookupUserResult> {
  const { data, error } = await supabase
    .from("users")
    .select("id, email")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    return { user: null, queryFailed: true };
  }

  if (!data) {
    return { user: null, queryFailed: false };
  }

  return {
    user: { id: data.id as string, email: data.email as string },
    queryFailed: false,
  };
}

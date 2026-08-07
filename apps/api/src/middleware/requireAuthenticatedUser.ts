import type { NextFunction, Request, Response } from "express";
import { supabase } from "../lib/supabaseClient";

/**
 * 이메일 기반 방문자 게이트(PRD 3.7)의 백엔드 검증 로직.
 *
 * `x-user-email` 헤더 값으로 `users` 테이블을 조회해 일치하는 row가 있으면
 * `req.user = { id, email }`를 설정하고 다음 핸들러로 넘긴다.
 *
 * 이 미들웨어는 "누가 요청을 허용받는가"만 판단한다. 가드 페이지 렌더링, 쿠키 발급 등
 * 프론트엔드 부분은 별도 기능(아직 미착수)의 책임이다.
 */
export async function requireAuthenticatedUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const email = req.header("x-user-email");

  if (!email) {
    res.status(401).json({ error: "unauthorized", message: "인증되지 않은 요청입니다." });
    return;
  }

  const { data, error } = await supabase
    .from("users")
    .select("id, email")
    .eq("email", email)
    .single();

  if (error || !data) {
    res.status(401).json({ error: "unauthorized", message: "인증되지 않은 요청입니다." });
    return;
  }

  req.user = { id: data.id as string, email: data.email as string };
  next();
}

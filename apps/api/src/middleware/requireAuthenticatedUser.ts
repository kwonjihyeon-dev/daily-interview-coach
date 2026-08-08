import type { NextFunction, Request, Response } from "express";
import { lookupUserByEmail } from "../lib/userLookup";

/**
 * 이메일 기반 방문자 게이트(PRD 3.7)의 백엔드 검증 로직.
 *
 * `x-user-email` 헤더 값으로 `users` 테이블을 조회해 일치하는 row가 있으면
 * `req.user = { id, email }`를 설정하고 다음 핸들러로 넘긴다.
 *
 * 이 미들웨어는 "누가 요청을 허용받는가"만 판단한다. 가드 페이지 렌더링, 쿠키 발급 등
 * 프론트엔드 부분은 별도 기능(이메일 기반 방문자 게이트)의 책임이다.
 *
 * `lookupUserByEmail`(신규 `POST /api/auth/verify-email`과 공유하는 헬퍼)로 내부 조회를
 * 위임한다. `queryFailed: true`(DB 조회 자체 실패)인 경우에도 여기서는 기존과 동일하게
 * 401 unauthorized로 응답한다 — 이 미들웨어의 외부 관찰 동작은 리팩터링 전후 동일해야
 * 한다(기존 resume.test.ts가 그대로 통과해야 함).
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

  const { user } = await lookupUserByEmail(email);

  if (!user) {
    res.status(401).json({ error: "unauthorized", message: "인증되지 않은 요청입니다." });
    return;
  }

  req.user = { id: user.id, email: user.email };
  next();
}

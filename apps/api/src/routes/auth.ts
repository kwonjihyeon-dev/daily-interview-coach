import { Router, type Request, type Response } from "express";
import { lookupUserByEmail } from "../lib/userLookup";
import { buildVisitorCookieOptions, VISITOR_COOKIE_NAME } from "../lib/visitorCookie";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md (v2)
 * "백엔드: POST /api/sessions (변경 — 엔드포인트 RESTful 재명명 + 쿠키 발급 추가)" 절.
 *
 * 미인증 방문자가 호출하는 엔드포인트다(정의상 인증 불필요). `app.ts`에서
 * `app.use("/api/sessions", authRouter)`로 마운트하며, 레거시 `requireApiKey`가
 * 완전히 삭제되어 더 이상 등록 순서를 신경 쓸 필요가 없다.
 */

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

const router: ReturnType<typeof Router> = Router();

function sendError(res: Response, status: number, error: string, message: string): void {
  res.status(status).json({ error, message });
}

router.post("/", async (req: Request, res: Response) => {
  const rawEmail = req.body?.email;

  if (typeof rawEmail !== "string" || rawEmail.trim().length === 0) {
    sendError(res, 400, "email_required", "이메일을 입력해주세요.");
    return;
  }

  const normalizedEmail = rawEmail.trim().toLowerCase();

  if (normalizedEmail.length > MAX_EMAIL_LENGTH || !EMAIL_FORMAT_REGEX.test(normalizedEmail)) {
    sendError(res, 400, "invalid_email_format", "올바른 이메일 형식이 아닙니다.");
    return;
  }

  const { user, isFailedQuery } = await lookupUserByEmail(normalizedEmail);

  if (isFailedQuery) {
    sendError(
      res,
      500,
      "internal_error",
      "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
    );
    return;
  }

  if (!user) {
    sendError(
      res,
      401,
      "email_not_found",
      "등록되지 않은 이메일입니다. 접근 권한이 있는 이메일인지 확인해주세요.",
    );
    return;
  }

  res.cookie(VISITOR_COOKIE_NAME, normalizedEmail, buildVisitorCookieOptions());
  res.status(201).json({ verified: true });
});

export default router;

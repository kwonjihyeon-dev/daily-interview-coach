import { Router, type Request, type Response } from "express";
import { lookupUserByEmail } from "../lib/userLookup";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md
 * "백엔드 보강: POST /api/auth/verify-email" 절.
 *
 * 미인증 방문자가 호출하는 엔드포인트이므로 app.ts에서 requireApiKey보다 먼저 등록된다.
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

  const { user, queryFailed } = await lookupUserByEmail(normalizedEmail);

  if (queryFailed) {
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

  res.status(200).json({ verified: true });
});

export default router;

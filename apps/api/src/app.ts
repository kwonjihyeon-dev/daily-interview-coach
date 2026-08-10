import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Express } from "express";
import resumeRouter from "./routes/resume";
import authRouter from "./routes/auth";
import questionsRouter from "./routes/questions";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md (v2)
 *
 * v2 재설계로 인증(판단 + 쿠키 발급/관리)을 전부 apps/api가 소유한다.
 * - `cors()`: 브라우저가 apps/api를 직접 호출(credentials:"include")하므로 필요.
 *   `ALLOWED_ORIGINS`(쉼표 구분) 목록에 정확히 일치하는 origin만 CORS 헤더를 부여한다
 *   (fail-closed — 미설정/빈 문자열이면 모든 브라우저발 요청이 차단된다). Origin 헤더가
 *   없는 비브라우저 호출(curl 등)은 그대로 통과한다.
 * - `cookieParser()`: `requireAuthenticatedUser`가 `req.cookies`를 읽어야 한다.
 * - 레거시 `requireApiKey`(고정 x-api-key)는 완전히 삭제되었다 — `/api/*` 전체가
 *   게이트 쿠키 인증(`requireAuthenticatedUser`) 하나로 통일된다.
 */

const app: Express = express();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      const allowed = (process.env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      callback(null, allowed.includes(origin));
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json());

// 헬스체크는 인증 없이 접근 가능
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// 이메일 기반 방문자 게이트(PRD 3.7) — POST /api/sessions는 정의상 미인증 방문자가
// 호출하는 엔드포인트다. 게이트 쿠키 인증만 남은 지금은 등록 순서 제약이 없다.
app.use("/api/sessions", authRouter);

// /api/sources/resume는 이 라우터 내부(resume.ts)에서 requireAuthenticatedUser
// 미들웨어를 직접 체이닝해 사용한다.
app.use("/api/sources/resume", resumeRouter);

// /api/questions는 이 라우터 내부(questions.ts)에서 requireAuthenticatedUser 미들웨어를
// 직접 체이닝해 사용한다(resume.ts와 동일 패턴).
app.use("/api/questions", questionsRouter);

export default app;

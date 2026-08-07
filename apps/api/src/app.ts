import express, { Express, NextFunction, Request, Response } from "express";
import resumeRouter from "./routes/resume";

const app: Express = express();
app.use(express.json());

// 헬스체크는 인증 없이 접근 가능
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// 이메일 기반 방문자 게이트(PRD 3.7) — /api/sources/resume는 아래 x-api-key 방식 대신
// 이 라우터 내부(resume.ts)에서 requireAuthenticatedUser 미들웨어를 직접 체이닝해 사용한다.
// 아래 requireApiKey보다 먼저 등록해야, 이 경로가 requireApiKey를 거치지 않고 바로 처리된다.
app.use("/api/sources/resume", resumeRouter);

// 고정 API 키 인증 (PRD 3.7 구버전) — Lambda 환경변수 API_KEY와 헤더 값 비교
// TODO: 이메일 기반 방문자 게이트(requireAuthenticatedUser)로 전체 마이그레이션 예정.
// 이번 스코프에서는 /api/sources/resume에만 새 인증 방식을 적용하고, 나머지 라우트는 유지한다.
function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const provided = req.header("x-api-key");
  if (!provided || provided !== process.env.API_KEY) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

app.use("/api", requireApiKey);

app.get("/api/questions/today", (_req, res) => {
  // TODO: Supabase에서 미답변 질문 조회 (PRD 4. 핵심 플로우 3단계)
  res.json({ question: null });
});

export default app;

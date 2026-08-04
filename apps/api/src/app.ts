import express, { Express, NextFunction, Request, Response } from "express";

const app: Express = express();
app.use(express.json());

// 헬스체크는 인증 없이 접근 가능
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// 고정 API 키 인증 (PRD 3.7) — Lambda 환경변수 API_KEY와 헤더 값 비교
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

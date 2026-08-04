import serverless from "serverless-http";
import app from "./app";

// AWS Lambda 핸들러 (PRD 3.2) — API Gateway 뒤에서 이 핸들러로 배포
export const handler = serverless(app);

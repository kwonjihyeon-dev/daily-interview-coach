import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

/**
 * AWS Bedrock(Claude) 호출 래퍼. 유일한 AI 호출 경계 — 라우트/lib는 이 함수만 의존하고,
 * 테스트에서는 이 모듈 전체를 모킹한다(`questions.test.ts`, `app.test.ts` 참고).
 *
 * `AWS_REGION`/`BEDROCK_MODEL_ID`는 `apps/api/.env`에 이미 설정되어 있다(PRD 3.1).
 */

let cachedClient: BedrockRuntimeClient | undefined;

function getClient(): BedrockRuntimeClient {
  if (!cachedClient) {
    cachedClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
  }
  return cachedClient;
}

export async function generateInterviewQuestions(prompt: string): Promise<string> {
  const client = getClient();

  const command = new InvokeModelCommand({
    modelId: process.env.BEDROCK_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const response = await client.send(command);
  const decoded = new TextDecoder().decode(response.body);
  const parsed = JSON.parse(decoded) as { content?: Array<{ text?: string }> };
  const text = parsed.content?.[0]?.text;

  if (typeof text !== "string") {
    throw new Error("Bedrock 응답에서 텍스트를 찾을 수 없습니다.");
  }

  return text;
}

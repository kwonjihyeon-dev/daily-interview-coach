# daily-interview-coach

매일 하나씩 면접 질문을 연습하고, AI 피드백과 스트릭으로 습관을 유지하는 개인용 도구.

## 구조

```
apps/
  web/    Next.js 프론트엔드
  api/    Node/Express 백엔드 (Lambda 배포용 serverless-http 래핑)
packages/
  shared-types/  프론트-백엔드 공유 타입
  config/        eslint/tsconfig 공통 설정
infra/           AWS 인프라 (Lambda, API Gateway 등) IaC
```

## 개발

```
pnpm install
pnpm dev
```

아키텍처 결정사항과 로드맵은 PRD 참고.

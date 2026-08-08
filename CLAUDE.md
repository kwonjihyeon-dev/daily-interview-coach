# daily-interview-coach

매일 하나씩 면접 질문을 연습하고, AI 피드백과 스트릭으로 습관을 유지하는 개인용 도구.

## 스택

-   **apps/web**: Next.js 14 (App Router)
-   **apps/api**: Express, Lambda 배포용 `serverless-http` 래핑, 이메일 기반 방문자 게이트 인증 (`x-user-email` 헤더 → `users` 테이블 DB 조회, PRD 3.7)
-   **packages/shared-types**: 프론트-백엔드 공유 타입 (Source, Question, Answer, AnswerFeedback, Streak)
-   **packages/config**: eslint/tsconfig 공통 설정
-   **infra**: AWS 인프라 (Lambda, API Gateway) — Phase 4에서 CDK/SST로 구현 예정
-   테스트 프레임워크: 미설정. 신규 기능은 **Vitest** 사용 (web: `@testing-library/react`, api: `supertest`)로 통일. `test-architect` 서브에이전트가 최초 사용 시 최소 설정을 추가함.

아키텍처 결정사항과 로드맵: [`.claude/docs/prd.md`](./.claude/docs/prd.md) (Bedrock/Supabase/Lambda 등 스택 선택 이유 포함, 모든 서브에이전트가 참고).

## 진행 상황 관리

[`.claude/docs/progress.md`](./.claude/docs/progress.md)에 PRD 마일스톤(Phase 0~5) 기준 완료 항목/다음 액션을 기록합니다.

-   **갱신 시점**: 서브에이전트 단계(spec/test/구현) 완료마다가 아니라, **Phase 단위 마일스톤이 끝나거나 인프라 설정(AWS 콘솔 작업, Supabase 프로젝트 생성 등)에 진전이 있을 때만**
-   `.claude/docs/prd.md`는 아키텍처 결정 기록으로 고정 — 진행 상황처럼 자주 바뀌는 상태는 여기 섞지 않고 `progress.md`에만 둠

## 기능 개발 워크플로우

새 기능을 구현할 때는 아래 3단계를 순서대로 거칩니다. **각 단계 사이에는 반드시 사용자 승인**을 받고 다음 단계로 넘어갑니다 — 승인 없이 자동으로 이어서 진행하지 않습니다.

```
사용자 요구사항
    ↓
[1] @spec-writer  — 모호한 요구사항 → 구체적 명세 (Acceptance Criteria 포함)
    출력: .claude/artifacts/spec/[기능명]_spec.md
    ↓
    ⏸️ 승인 대기
    ↓
[2] @test-architect — 명세 → 실패하는 완전한 테스트 코드 (TDD Red)
    출력: .claude/artifacts/test/[기능명]_test.md
           apps/{web,api}/src/**/[파일명].test.ts(x)
    ↓
    ⏸️ 승인 대기
    ↓
[3] @developer — 테스트를 통과시키는 최소 구현 + 리팩토링 (TDD Green + Refactor)
    출력: apps/{web,api}/src/ 하위 구현 파일
    ↓
    ⏸️ 승인 대기 → 완료
```

**단계 사이(⏸️)의 승인 게이트는 그대로 유지합니다** — spec 승인 없이 test-architect로, test 승인 없이 developer로 넘어가지 않습니다.

**단계 안에서의 승인 범위**: 각 서브에이전트는 작업을 시작하기 전 전체 계획(예: 설치할 패키지 목록, 처리 순서, 건드릴 파일)을 한 번 사용자에게 보여줍니다. 그 계획을 보여준 시점 자체가 승인 기회이므로, **계획에 이미 포함된 개별 항목은 실행 단계에서 또 물어보지 않고 그대로 진행**합니다 (예: "`@supabase/supabase-js` 설치가 필요합니다"라고 계획에 언급했다면, 실제 설치 시점에 다시 승인을 구하지 않음). 계획에 없던 새로운 결정(스코프 변경, 예상 못한 트레이드오프)이 작업 중 생기면 그건 별도로 확인합니다. 모든 서브에이전트(spec-writer/test-architect/developer)에 동일하게 적용됩니다.

이 3단계는 원래 spec-writer / po / test-architect / developer / refactor 5단계였던 것을 개인 프로젝트 규모에 맞게 축소한 것입니다.

-   **po가 담당하던 Acceptance Criteria(Given-When-Then)**는 spec-writer 산출물에 포함시켜 test-architect가 바로 테스트로 옮길 수 있게 함. User Story 서사, INVEST 검증, Story Points 추정처럼 팀 협업 조율용 산출물은 생략.
-   **refactor가 담당하던 개선 작업**은 developer 단계에 흡수 — 구현 후 테스트를 유지한 채로 바로 리팩토링까지 수행.

간단한 버그 수정이나 이미 명세가 명확한 작은 변경은 이 워크플로우를 강제하지 않고 바로 구현해도 됩니다. 워크플로우는 **범위가 불명확하거나 여러 파일에 걸친 새 기능**에 사용합니다.

## 오케스트레이션 방식

각 단계는 격리된 컨텍스트에서 도는 서브에이전트(`.claude/agents/spec-writer.md`, `test-architect.md`, `developer.md`)로 실행됩니다. 서브에이전트는 스스로 다음 단계를 호출하지 않습니다 — 메인 세션이 다음을 담당합니다.

1. 사용자 요청을 보고 현재 필요한 단계 판단
2. 해당 서브에이전트를 필요한 컨텍스트(이전 단계 파일 경로 등)와 함께 호출
3. 결과를 사용자에게 제시하고 승인 대기
4. 승인 시 다음 단계 서브에이전트 호출, 필요한 경우 이전 단계로 롤백

## 산출물 및 파일 규칙

```
.claude/artifacts/
├── spec/
│   └── [기능명]_spec.md
└── test/
    └── [기능명]_test.md

apps/web/src/
└── **/[파일명].test.tsx   (컴포넌트 옆에 배치)

apps/api/src/
└── **/[파일명].test.ts    (라우트/서비스 옆에 배치)
```

-   기능명: 한글 또는 영문 소문자, 공백 대신 하이픈
-   커밋은 사용자가 명시적으로 요청하거나 phase가 끝날 때 커밋 승인 요청 후 승인 시에만 수행 (단계 완료마다 자동 커밋하지 않음)

## 일반 컨벤션

-   TypeScript strict, `any` 지양
-   함수명은 `handle` 접두사(`handleSubmit`, `handleResumeUpload` 등) 대신 **동사+목적어** 형태로 작성 (`submitForm`, `uploadResume`). 이벤트 핸들러(`onSubmit={submitForm}`)에도 동일하게 적용
-   불리언 변수/필드명은 `is` 접두사로 작성 (`isFailedQuery`, `isSubmitting`)
-   시간 관련 값은 KST(UTC+9) 기준, ISO 8601 형식
-   방문자 인증은 이메일 기반 게이트 + `users` 테이블 DB 조회 방식 (PRD 3.7) — 별도 회원가입/비밀번호 시스템 추가하지 않음
-   Over-engineering 금지: 테스트를 통과시키는 최소 구현 우선, YAGNI 원칙

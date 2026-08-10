## 구현 완료: 질문-생성

### 시작 시 세운 계획

**apps/api**
1. `pnpm --filter @daily-interview-coach/api add @aws-sdk/client-bedrock-runtime` 설치
2. 신규 `src/lib/bedrockClient.ts` — `generateInterviewQuestions(prompt): Promise<string>`
3. 신규 `src/lib/questionGeneration.ts` — 상수, `buildQuestionGenerationPrompt`,
   `parseGeneratedQuestions`, `generateAndSaveQuestionBatch`, `findLatestResumeSourceId`,
   `selectTodayQuestion`, `toKstIso`, 에러 클래스
4. 신규 `src/routes/questions.ts` — `POST /generate`, `GET /today`
5. 수정 `src/app.ts` — 인라인 stub 제거, `questionsRouter` 마운트(스펙/테스트에 이미 명시된 변경)
6. 수정 `package.json` — 의존성 추가

**apps/web**
7. 수정 `ResumeUploadForm.tsx` — `questionGenerationStatus`/`generationErrorMessage` 추가,
   자동 트리거 + stale-response 가드 + StrictMode 중복 방지
8. 신규 `app/today/page.tsx` (Server Component)
9. 신규 `app/today/EmptyQuestionState.tsx` (Client Component)

계획대로 실행했고, 진행 중 스코프 변경이나 예상 못한 트레이드오프는 없었습니다.

### 테스트 통과 현황
- 신규/수정 대상 테스트(53개): 53/53 통과
  - `apps/api/src/routes/questions.test.ts`: 31/31
  - `apps/api/src/app.test.ts`: 10/10 (신규 케이스 없음, 안전망 mock만 확인)
  - `apps/web/src/app/ResumeUploadForm.test.tsx`: 30/30 (기존 18 + 신규/수정 12)
  - `apps/web/src/app/today/page.test.tsx`: 4/4
  - `apps/web/src/app/today/EmptyQuestionState.test.tsx`: 6/6
- 기존 통과 테스트: 회귀 없음
  - `apps/api` 전체: 85/85 (`pnpm --filter @daily-interview-coach/api test`)
  - `apps/web` 전체: 95/95 (`pnpm --filter @daily-interview-coach/web test`, `apiClient.test.ts` 15/15 그대로 통과)
  - 루트 `pnpm test`(turbo)로도 동일하게 재확인: 두 패키지 모두 성공
- 타입체크: `pnpm typecheck` 통과 (api/web 모두 에러 없음)

### 구현 파일

**신규**
- `apps/api/src/lib/bedrockClient.ts` — Bedrock InvokeModel 호출 래퍼(테스트에서는 전체 모킹, 실제 경로는 `AWS_REGION`/`BEDROCK_MODEL_ID` 사용)
- `apps/api/src/lib/questionGeneration.ts` — 프롬프트 빌드/파싱/생성·저장/오늘의 질문 선택
- `apps/api/src/routes/questions.ts` — `POST /api/questions/generate`, `GET /api/questions/today`
- `apps/web/src/app/today/page.tsx` — 오늘의 질문 표시 Server Component
- `apps/web/src/app/today/EmptyQuestionState.tsx` — "질문 소진" 재생성 Client Component

**수정**
- `apps/api/src/app.ts` — 인라인 `GET /api/questions/today` stub 제거 → `app.use("/api/questions", questionsRouter)`
- `apps/api/package.json` — `@aws-sdk/client-bedrock-runtime` 의존성 추가
- `apps/web/src/app/ResumeUploadForm.tsx` — 질문 생성 자동 트리거 상태(`questionGenerationStatus`/`generationErrorMessage`), stale-response 가드(`uploadedSourceRef`), 중복 트리거 가드(`generationRequestedSourceIdRef`), CTA 활성화/라우팅, "다시 시도"

### 기존 코드 수정

`apps/api/src/app.ts`(라우트 배선)와 `apps/web/src/app/ResumeUploadForm.tsx`(Props 변경은 없음, 내부 상태·렌더링 확장)를 수정했습니다. 두 변경 모두 이미 Approved된 스펙("대상 파일" 표, v2)과 이미 Approved된 테스트(`app.test.ts`의 안전망 mock, `ResumeUploadForm.test.tsx`의 신규/수정 12개 케이스)에 명시적으로 전제된 변경이라, 이번 단계에서 별도 승인 요청 없이 진행했습니다. `ResumeUploadForm.tsx`의 함수 시그니처/Props는 변경하지 않았습니다(컴포넌트는 여전히 인자 없이 호출).

### 리팩토링

- 최초 구현에서 프롬프트 리터럴의 줄바꿈 위치 때문에 `"어떻게 생각하나요"` substring이 두 줄로 쪼개져 테스트가 실패했습니다(Green 단계 중 발견) — 줄바꿈 위치만 조정해 해당 문구가 한 줄에 오도록 수정했습니다. 이 외에는 최초 구현이 Green을 바로 통과했고, 함수 단위가 이미 작고 명확해 추가 리팩토링은 하지 않았습니다(YAGNI).

### 스펙과 다르게 판단/구현한 지점

1. **`sourceId` 생략 시 source 조회 2회**: `findLatestResumeSourceId`는 이름 그대로 `id`만 반환하도록 하고, 이후 명시적 `sourceId` 케이스와 동일한 "id+user_id로 sources 조회" 함수(`fetchOwnedSource`)를 재사용해 전체 row(및 type 검증)를 가져오도록 구현했습니다. 스펙은 이 부분을 "findLatestResumeSourceId(질의 결과)의 몫"이라고만 서술해 1회/2회 조회 여부를 특정하지 않았고, 테스트의 Supabase mock(`sourcesResolve`)이 영속적 `mockResolvedValue`라 조회 횟수와 무관하게 통과합니다. 코드 재사용(명시적/생략 경로가 동일한 검증 함수를 거침)을 우선했습니다.
2. **prefetch의 "미답변 개수" 조회 쿼리 형태**: 실제 Supabase 쿼리는 `count: "exact", head: true` + `.is("answers.id", null)` 조합으로 작성했습니다. 테스트의 제네릭 Proxy mock은 이 쿼리의 정확한 문법을 검증하지 않고 `count` 필드 값만으로 동작을 결정하므로, 실제 프로덕션 환경에서 이 특정 PostgREST 임베디드 리소스 필터 문법이 의도대로 동작하는지는 로컬 Supabase 인스턴스로 별도 확인이 필요합니다(테스트로는 검증되지 않은 부분).
3. **existing-questions 조회 실패 시 처리**: 스펙의 "처리 순서" 표는 4단계("기존 질문 텍스트 조회")의 실패 시 상태코드를 명시하지 않았습니다. 다른 DB 조회 실패와 동일하게 `QuestionPersistenceError`(500 `internal_error`)로 처리했습니다 — 테스트가 이 케이스를 직접 검증하지는 않지만, 조용히 넘어가는 것보다 명시적 실패가 안전하다고 판단했습니다.
4. **Bedrock 프롬프트의 "이미 생성된 질문 목록" 섹션**: 스펙 템플릿 문구를 그대로 따라 헤더 라인(`[이미 생성된 질문 목록] (있는 경우, 최근 N개까지)`)은 기존 질문 유무와 무관하게 항상 포함하고, 본문만 "(없음)" 또는 실제 목록으로 구성했습니다(스펙의 "6번 규칙"만 조건부이고 섹션 헤더 자체는 조건부라는 명시가 없어 템플릿 원문을 그대로 따랐습니다).

### 남은 이슈 / 후속 승인 필요 지점

- 스펙의 "Open Questions" 3항목(상수값, Lambda fire-and-forget 리스크, 동시성 dedup 미구현)은 이번 구현에서 재검토하지 않고 제안값 그대로 사용했습니다 — 별도 확인이 필요하면 알려주세요.
- 위 "스펙과 다르게 판단한 지점 2"의 실제 Supabase 쿼리 문법은 실제 DB 연동 전 검증이 필요합니다.

**Status**: Implementation Complete

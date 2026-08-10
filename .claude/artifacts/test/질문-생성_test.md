# 테스트 명세: AI 질문 생성

- 대상 스펙: `.claude/artifacts/spec/질문-생성_spec.md` (v2, Approved)
- 총 테스트 케이스(신규 + 수정): **53개** (정상 15 / 엣지 27 / 에러 11)
- 실행 결과: **53/53 실패 (구현 없음 — 정상, TDD Red)**, 기존 통과 테스트(84개)는 무손상

| 파일 | 정상 | 엣지 | 에러 | 계 |
| --- | --- | --- | --- | --- |
| `apps/api/src/routes/questions.test.ts` (신규) | 6 | 20 | 5 | 31 |
| `apps/api/src/app.test.ts` (수정 — 안전망 mock만 추가, 신규 테스트 없음) | - | - | - | 0 |
| `apps/web/src/app/ResumeUploadForm.test.tsx` (신규 9 + 기존 3개 수정) | 5 | 5 | 2 | 12 |
| `apps/web/src/app/today/page.test.tsx` (신규) | 1 | 1 | 2 | 4 |
| `apps/web/src/app/today/EmptyQuestionState.test.tsx` (신규) | 3 | 1 | 2 | 6 |
| **계** | **15** | **27** | **11** | **53** |

## 실행 결과 (검증 완료)

- `apps/api`: `npx vitest run` → `questions.test.ts`가 `Failed to load url ./questions`로 즉시 실패(구현 파일 없음) — 31개 테스트 모두 미실행 상태로 실패. 기존 5개 파일(54개 테스트)은 그대로 통과.
- `apps/web`: `npx vitest run` → `today/page.test.tsx`(4개), `today/EmptyQuestionState.test.tsx`(6개)는 모듈 자체가 없어 즉시 실패. `ResumeUploadForm.test.tsx`는 총 30개(기존 21개 중 18개는 그대로 유지 + 3개 수정 + 9개 신규) 중 신규/수정 12개만 실패, 나머지 18개는 그대로 통과 — 정확히 이번에 새로 추가하거나 v2 스펙에 맞춰 수정한 케이스만 실패하는 것을 확인했습니다.
- 검증 방법: 각 신규 파일에 대해 최소 스텁(임시, 커밋 대상 아님)을 만들어 테스트가 "모듈 없음" 오류가 아니라 "assertion 불일치"로 깨끗하게 실패하는지 확인한 뒤 스텁을 삭제했습니다. 크래시나 mock 설계 버그 없이 의도한 지점에서만 실패합니다.

## 파일 목록

### apps/api

- **`apps/api/src/routes/questions.test.ts`** (신규) — `POST /api/questions/generate`, `GET /api/questions/today` 전체 Acceptance Criteria 커버.
  - `requireAuthenticatedUser`(인증), `../lib/supabaseClient`(DB), `../lib/bedrockClient`(AI 호출)만 진짜 외부 경계로 보고 모킹. `questionGeneration.ts`(프롬프트 구성/파싱/저장/선택)는 실제 로직이 그대로 실행되도록 남겨둬, "Bedrock에 전달된 prompt에 핵심 substring 포함 여부", "questions 테이블에 실제 N개 row 삽입" 같은 AC를 직접 관찰할 수 있게 했습니다.
  - Supabase는 임의의 체이닝 메서드 조합에 결합되지 않는 제네릭 Proxy 기반 mock으로 처리(파일 상단 주석에 설계 의도와 라우트/lib 책임 분담 가정을 상세히 기록).
- **`apps/api/src/app.test.ts`** (수정) — 신규 테스트는 추가하지 않았습니다. `GET /api/questions/today`가 인라인 stub에서 실제 `questions` 라우터로 교체된 뒤에도 기존 CORS/인증 배선 테스트(10개)가 진짜 Supabase 네트워크 호출 없이 계속 통과하도록 `supabaseClient`/`bedrockClient` 안전망 mock만 추가했습니다.

### apps/web

- **`apps/web/src/app/ResumeUploadForm.test.tsx`** (확장) — 업로드 성공 직후 자동 질문 생성 트리거, 상태 전이(`generating`/`ready`/`error`), stale-response 가드, StrictMode 중복 호출 방지, 401/네트워크 에러 케이스를 다루는 3개 describe 블록(정상/엣지/에러) 신규 추가.
  - 기존 테스트 중 3개는 v2 스펙(업로드 직후 자동 생성 트리거)과 문자 그대로 충돌해 **불가피하게 수정**했습니다:
    1. "201 응답을 받으면..." 테스트: 기존 정적 문구 "준비 중입니다." 검증을 신규 "이력서 저장 완료 · 질문을 생성 중입니다" 문구 검증으로 교체(스펙이 명시적으로 이 정적 문구를 대체하도록 요구).
    2. "면접 진행하기 버튼은 항상 비활성화" 테스트: "생성 중(generating) 상태에서는 비활성화"로 의미를 좁혀 재작성(CTA가 이제 `ready` 상태에서 활성화되는 것 자체가 이번 기능의 목적이므로, "항상 비활성화"라는 기존 전제가 더 이상 성립하지 않음).
    3. "500 storage_upload_failed 재시도" 테스트: 재시도가 성공(201)으로 이어지면서 자동 생성 호출이 추가로 발생해 `fetch` 총 호출 횟수가 2 → 3으로 바뀌는 부분만 반영(재시도 자체를 검증하는 인덱스 참조는 그대로 유효).
- **`apps/web/src/app/today/page.test.tsx`** (신규) — Server Component를 `gate/page.test.tsx`와 동일한 방식(직접 함수 호출)으로 검증. `apiGet` 모킹, `EmptyQuestionState`는 렌더링 여부만 확인하는 스텁으로 모킹(중복 방지).
- **`apps/web/src/app/today/EmptyQuestionState.test.tsx`** (신규) — "다시 시도" 클릭 시 `GET /today`가 아니라 `POST /generate`(`{}`)를 직접 호출하는지, 응답의 `question`으로 자체 상태를 갱신하는지(별도 `GET /today` 재호출 없음), 401/네트워크 에러 처리를 검증.

## 핵심적으로 반영한 요청 사항

- 프롬프트 검증: 정확한 문자열 일치가 아니라 Bedrock mock 호출 인자에 `"15년차 이상"`, `"트레이드오프"`, `"어떻게 생각하나요"`, `"정확히 15개"`, 이력서 원문, (기존 질문이 있을 때만) `"이미 생성된 질문 목록"` + 각 텍스트가 포함되는지로 검증.
- `sourceId` 생략 시 자동 resolve(최근 resume source), 빈 문자열/숫자/`null`은 400 `invalid_source_id`로 구분 처리.
- 미답변 개수 3/5/6개에 따른 prefetch(`generateAndSaveQuestionBatch`, 관찰 프록시로 Bedrock 호출 여부 사용) 트리거 여부, source 없을 때 조용히 스킵.
- `generate` 응답의 `question` 필드가 기존 미답변 질문(FIFO) 우선순위를 유지하는지, 새 배치 중 가장 먼저 생성된 것과 일치하는지 각각 별도 케이스로 검증.
- 프론트 stale-response 가드(업로드 리셋 후 지연 도착한 생성 응답 무시), StrictMode 2회 effect 실행 시에도 생성 요청 1회만 발생하는지 검증.
- `EmptyQuestionState`가 재시도 시 `POST /generate`만 호출하고 별도 `GET /today` 재호출을 하지 않는지, 응답의 `question`으로 직접 상태를 갱신하는지 검증.

## 설계상 주요 가정 (developer 검토 필요)

`questions.test.ts`는 스펙의 "sourceId 해석 규칙"과 "처리 순서" 표를 가장 단순하게 해석해, 아래 책임 분담을 전제로 테스트를 작성했습니다(파일 상단 주석에도 동일하게 기록):

- `sourceId` 해석(생략 시 `findLatestResumeSourceId` 사용, 형식 검증)과 "sources 테이블에서 `id`+`user_id`로 존재/타입 확인" 쿼리는 **라우트가 직접** 수행.
- 프롬프트 구성 → Bedrock 호출 → 파싱 → batch insert → `selectTodayQuestion` 호출은 **`generateAndSaveQuestionBatch`/`selectTodayQuestion`(`questionGeneration.ts`)** 이 전담.
- prefetch의 "미답변 개수 조회"는 라우트가 직접 supabase에 질의.

이 가정과 실제 developer 구현이 크게 어긋나면(예: 검증 로직을 전부 lib로 옮기는 경우) `questions.test.ts`의 Supabase mock 호출 순서/횟수 조정이 필요할 수 있습니다 — 다만 HTTP 상태코드/에러코드/응답 바디 형태 등 스펙의 관찰 가능한 계약 자체는 이 가정과 무관하게 유효합니다.

---
**Status**: Test Specification Complete (TDD Red — 53개 신규/수정 테스트 모두 실패 확인, 기존 통과 테스트 무손상 확인)
**Next Action**: 테스트 코드를 확인하신 후 승인해주시면 @developer에게 구현을 요청하겠습니다.

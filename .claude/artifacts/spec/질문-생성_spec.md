# 기능 명세: AI 질문 생성

## 개요

이력서 업로드가 완료된 직후, AWS Bedrock(Claude, `global.anthropic.claude-sonnet-4-6`)을 호출해 그 이력서를 기반으로 면접 질문을 생성하고 `questions` 테이블에 저장한다. 생성은 "이력서 내용 확인"이 아니라 "면접 준비"가 목적이므로, 이력서에 명시된 키워드에 국한하지 않고 연관 개념·트레이드오프까지 확장하며, 일부는 사고형("어떻게 생각하냐") 질문으로 구성한다. 생성된 질문 중 미답변 질문 하나를 보여주는 조회 API(`GET /api/questions/today`)도 이번 기능에서 실제로 구현하며, 이 조회 시점에 남은 미답변 질문이 임계치 이하면 백그라운드로 다음 배치를 미리 생성한다(PRD 3.5, 미리 채워두기).

이번 기능의 책임 범위는 **질문 생성 파이프라인 동작 확인 + 화면에 오늘의 질문 텍스트가 실제로 뜨는 것까지**이며, 답변 입력·저장·스트릭은 다음 vertical slice("오늘의 질문 — 답변 저장 + 스트릭")의 책임이다.

## 선행 결정 사항

| 항목 | 결정 | 근거 |
| --- | --- | --- |
| 생성 트리거 주체(온보딩) | **프론트엔드가 업로드 성공(201) 직후 자동으로 `POST /api/questions/generate` 호출** (버튼 클릭 없음), `sourceId`는 방금 업로드된 `Source.id`를 명시적으로 전달 | 이미 Approved된 이력서 업로드 API/테스트를 재오픈하지 않음. "저장 완료"→"생성 중"→"준비 완료"를 화면에서 순차적으로 구분해서 보여줘야 하는 요구사항과 자연스럽게 맞음 |
| Notion 소스 | 이번 스코프에서 **미지원**. 대상 source의 `type`이 `'notion'`이면 400 에러 | 사용자 요구사항: "이번 기능은 이력서 텍스트만을 입력으로 가정" |
| AI 모델/리전 | `BEDROCK_MODEL_ID`(`global.anthropic.claude-sonnet-4-6`), `AWS_REGION`(`ap-northeast-2`) — 둘 다 `apps/api/.env.example`에 이미 존재, 신규 환경변수 추가 없음 | PRD 3.1 확정 사항 그대로 재사용 |
| 카테고리 체계 | 고정 enum 없이 **AI가 생성하는 자유 문자열**(`questions.category`는 DB에도 `text not null`, CHECK 제약 없음) | "카테고리별 최소 개수 강제는 없음" 요구사항과 스키마 제약 둘 다와 일치 |
| 생성 성공/실패 판정 기준 | Bedrock 응답을 파싱해 유효한 질문이 **5개 미만이면 생성 실패**로 간주 | 완전 실패(파싱 불가)와 부분 오염(일부 항목만 이상함)을 구분해, 부분 오염 시에도 유효한 질문만 살려서 저장(가용성 우선) |
| "사고형 질문 비율/인접개념 확장" 검증 범위 | **프롬프트에 해당 지시문이 포함되는지까지만 코드 레벨로 테스트 가능**하며, 실제 생성된 질문이 그 지시를 얼마나 잘 따르는지(품질)는 모델의 비결정적 출력이라 자동화된 단위 테스트로 검증할 수 없음 | organizationInstructions의 "확신 있는 척 답하지 말 것" 원칙과 동일한 취지 — 테스트 가능한 것과 아닌 것을 명확히 구분해야 test-architect가 잘못된(플레이키한) 테스트를 설계하지 않음 |
| 페르소나 | 프롬프트의 면접관 페르소나는 **"15년차 이상 소프트웨어 개발자"** | 사용자 확정 지침(v2) — 최초 초안의 "10년차"에서 상향 조정 |
| GET /today 미답변 우선순위 | **생성일(`created_at`) 오름차순(FIFO)** 중 답변 없는 첫 번째 | PRD 4절 "미답변 질문 중 하나를 우선 노출"이 구체적 우선순위를 정하지 않아, 가장 단순하고 결정적인 규칙 채택 |
| 미리 채워두기 트리거 위치 | `GET /api/questions/today` 응답 시점에 남은 미답변 개수를 계산해, 임계치 이하면 **fire-and-forget(응답을 기다리지 않는 비동기 호출)**으로 재생성 | 사용자가 소진 시점을 체감하지 않아야 한다는 PRD 3.5 요건. 단, 이 방식은 Lambda 배포(Phase 4) 시 응답 반환 후 함수가 종료되며 백그라운드 작업이 강제 중단될 위험이 있음 — **Open Question으로 별도 표시** |
| `GET /today`에서 `question: null`의 의미(v2) | 이 제품 흐름상 온보딩 시 항상 첫 배치가 생성되므로, `/today`에서 `question`이 `null`인 경우는 **실질적으로 항상 "질문 소진" 상황**으로 간주한다 (질문이 "아직 준비 안 됨"이 아니라 "다 썼음"). 화면 문구와 동작을 이 전제로 설계한다 | 사용자 확정 지침(v2) |
| `/today`의 "다시 시도" 동작(v2) | `GET /today`를 재호출하지 않고 **`POST /api/questions/generate`를 직접 호출**한다 | 사용자의 의도는 "새로 생성해줘"이지 "다시 조회해줘"가 아님(v2 확정 지침) |
| `POST /generate`의 `sourceId`(v2) | **선택값(optional)**으로 변경. 생략 시 백엔드가 해당 사용자의 **가장 최근 생성된 `type='resume'` source**를 자동 사용(기존 prefetch의 "최근 resume source 조회" 로직 재사용, 새 로직 아님). 생략됐는데 resume source가 하나도 없으면 404 `source_not_found`. 온보딩 흐름(`ResumeUploadForm`)은 기존처럼 `sourceId`를 계속 명시적으로 전달 — 변경 없음 | 사용자 확정 지침(v2) — `/today`의 "다시 시도" 시점엔 프론트가 어떤 source를 기준으로 생성해야 할지 알 방법이 없음 |
| `POST /generate` 응답 확장(v2) | 배치 insert 직후 서버가 내부적으로 `GET /today`와 동일한 "미답변 질문 중 FIFO 하나 선택" 로직(`selectTodayQuestion`)을 호출해 결과를 `question` 필드로 함께 반환한다: `{ "questions": [...], "question": <Question> }` | 클라이언트가 "생성 → 표시용 재조회"로 요청을 두 번 엮지 않고, "어떤 질문을 보여줄지" 결정 책임을 백엔드가 전담하도록 하기 위함. HTTP 왕복은 1회로 유지 |

## 상세 명세

### 트리거 흐름 개요

```
[온보딩] 이력서 업로드 성공(201, uploadedSource 확보)
        ↓ (프론트, 자동, 클릭 없음)
POST /api/questions/generate { sourceId: uploadedSource.id }
        ↓ 화면: "이력서 저장 완료 · 질문을 생성 중입니다"
   ┌─────────────┴─────────────┐
 성공(201)                    실패(4xx/5xx/네트워크 예외)
   ↓                             ↓
화면: "질문이 준비됐어요 ·      화면: "질문 생성에 실패했어요" + "다시 시도" 버튼
면접 준비를 시작할까요?"          (재클릭 시 동일 sourceId로 재요청)
+ CTA "면접 진행하기" 활성화
   ↓ (사용자 클릭)
router.push("/today")
   ↓
GET /api/questions/today
   ┌─────────────┴─────────────┐
 question 있음                question === null ("질문 소진"으로 간주)
   ↓                             ↓
질문 텍스트 표시                화면: "질문 생성에 문제가 있어요. 한번 더
(+ 응답 시점에 남은 미답변         시도해주세요" + "다시 시도" 버튼
 개수 ≤ 임계치면 백그라운드         ↓ (사용자 클릭, GET 재호출 아님)
 재생성 트리거 — 변경 없음)      POST /api/questions/generate {} (sourceId 생략)
                                  ↓ "생성 중..." 비활성화, 동기 대기
                               성공(201) → 응답의 question을 그대로 렌더링
                               실패 → 에러 메시지 + "다시 시도" 유지
```

### 상수 (제안값 — 전부 Open Question, 아래 "Open Questions" 절 참고)

| 상수 | 값 | 의미 |
| --- | --- | --- |
| `REQUESTED_QUESTION_COUNT` | 15 | 프롬프트에 명시하는 목표 생성 개수 |
| `MIN_VALID_QUESTIONS` | 5 | 파싱·검증 후 유효 질문이 이 미만이면 생성 전체를 실패로 처리 |
| `MAX_QUESTIONS_STORED` | 30 | 방어적 상한 — 초과분은 앞에서부터 잘라 저장(비용 폭주 방지) |
| `PREFETCH_THRESHOLD` | 5 | 미답변 질문 잔여 개수가 이 이하면 백그라운드 재생성 트리거 |
| `EXISTING_QUESTIONS_CONTEXT_LIMIT` | 100 | 프롬프트의 "이미 생성된 질문 목록"에 포함할 최대 개수(최근 생성순) |

### API 1 — `POST /api/questions/generate`

```
Headers:
  Cookie: dic_visitor_email=...  (requireAuthenticatedUser 미들웨어, resume.ts와 동일 패턴)
  Content-Type: application/json
Body (v2 — sourceId 선택값):
  { "sourceId": "<uuid>" }   // 온보딩 흐름: 명시적으로 전달
  또는
  {}                          // /today "다시 시도" 흐름: sourceId 키 자체를 생략
```

**처리 순서** (실패 시점에 즉시 응답):

| 순서 | 단계 | 실패 시 상태코드 | 에러 코드 |
| --- | --- | --- | --- |
| 1 | 인증 확인 (`req.user` 존재) | 401 | `unauthorized` |
| 2 | **`sourceId` 해석** — 아래 "sourceId 해석 규칙" 참고 | 400 / 404 | `invalid_source_id` / `source_not_found` |
| 3 | 해석된 source의 `type`이 `'resume'`인지 확인 | 400 | `unsupported_source_type` |
| 4 | 해당 사용자의 기존 질문 텍스트 전체를 조회(최근 생성순 `EXISTING_QUESTIONS_CONTEXT_LIMIT`개까지) | — | — |
| 5 | 프롬프트 구성 후 Bedrock 호출 (`generateInterviewQuestions`) | 500 | `generation_failed` |
| 6 | 응답 파싱·검증 (아래 "응답 파싱 규칙" 참고), 유효 질문 < `MIN_VALID_QUESTIONS`면 실패 | 500 | `generation_failed` |
| 7 | `questions` 테이블에 batch insert (`source_id`=해석된 sourceId, `user_id`=req.user.id, `origin`='ai') | 500 | `internal_error` |
| 8 | `selectTodayQuestion(req.user.id)`로 표시용 질문 1개 선택(GET /today와 동일 로직 재사용) | — | (7단계에서 방금 5개 이상 삽입했으므로 이론상 항상 결과가 존재) |
| 9 | 성공 응답 | 201 | — |

**`sourceId` 해석 규칙 (2단계, v2)**:

1. 요청 body에 `sourceId` 키 자체가 없으면(온보딩이 아닌 "다시 시도" 흐름) → `findLatestResumeSourceId(req.user.id)`로 해당 사용자의 `type='resume'` source 중 `created_at` 내림차순 1건을 조회한다. 결과가 없으면 404 `source_not_found`.
2. 요청 body에 `sourceId` 키가 있지만 값이 비어있지 않은 문자열이 아니면(숫자, `null`, 빈 문자열 등) → 400 `invalid_source_id`.
3. 요청 body에 `sourceId`가 유효한 비어있지 않은 문자열이면 → `id = sourceId AND user_id = req.user.id`로 `sources`를 조회한다. 결과가 없으면(존재하지 않거나 다른 사용자 소유) 404 `source_not_found`.

**응답 파싱 규칙** (5~6단계):

1. Bedrock 응답 텍스트에서 마크다운 코드펜스(` ```json ... ``` ` 등)가 있으면 제거 후 `JSON.parse` 시도. 파싱 자체가 실패하면 즉시 `generation_failed`.
2. 파싱 결과가 배열이 아니면 `generation_failed`.
3. 각 항목에서 `category`(trim 후 1~50자), `text`(trim 후 1~500자)가 유효한 항목만 통과. 조건 위반 항목은 조용히 버림(에러 아님).
4. 대소문자 무시·공백 정규화 기준으로 (a) 같은 배치 내 중복 `text`, (b) 4단계에서 조회한 기존 질문 `text`와 동일한 항목을 제거.
5. 남은 유효 항목이 `MIN_VALID_QUESTIONS`(5) 미만이면 `generation_failed`.
6. 남은 유효 항목이 `MAX_QUESTIONS_STORED`(30) 초과면 앞 30개까지만 사용.

**응답 형식 (v2 — `question` 필드 추가)**:

성공(201):
```json
{
  "questions": [
    {
      "id": "uuid",
      "userId": "uuid",
      "sourceId": "uuid",
      "category": "Next.js/SSR",
      "text": "...",
      "origin": "ai",
      "createdAt": "2026-08-10T09:12:00+09:00"
    }
  ],
  "question": {
    "id": "uuid",
    "userId": "uuid",
    "sourceId": "uuid",
    "category": "...",
    "text": "...",
    "origin": "ai",
    "createdAt": "2026-08-10T09:12:00+09:00"
  }
}
```
(`shared-types`의 `Question` 타입 그대로 사용, 수정 없음)

- `question`은 이번 방금 생성한 배치의 항목일 수도, 그 이전부터 존재하던 더 오래된 미답변 질문일 수도 있다 — `selectTodayQuestion`이 항상 FIFO(생성일 오름차순) 기준으로 고르기 때문이다(아래 Acceptance Criteria 참고).
- 온보딩 흐름(`ResumeUploadForm`)은 이 응답의 `question` 필드를 사용하지 않고 무시한다 — `/today` 이동 시 별도로 `GET /api/questions/today`를 호출해 표시한다(아래 "프론트엔드" 절 참고). `question` 필드는 `/today` "다시 시도" 흐름 전용으로 소비된다.

실패 공통 형식(기존 spec들과 동일):
```json
{ "error": "<snake_case 코드>", "message": "<한글 메시지>" }
```

| error 코드 | 상태코드 | message |
| --- | --- | --- |
| `unauthorized` | 401 | "인증되지 않은 요청입니다." |
| `invalid_source_id` | 400 | "유효하지 않은 이력서 식별자입니다." |
| `source_not_found` | 404 | "이력서를 찾을 수 없습니다." |
| `unsupported_source_type` | 400 | "현재는 이력서 기반 질문 생성만 지원합니다." |
| `generation_failed` | 500 | "질문 생성에 실패했습니다. 잠시 후 다시 시도해주세요." |
| `internal_error` | 500 | "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." |

### 프롬프트 설계 (developer가 그대로 구현, 핵심 문구는 리터럴로 고정, v2 — 페르소나 "15년차 이상")

```
당신은 15년차 이상 소프트웨어 개발자로 일하고 있는 면접관입니다. 아래 지원자의 이력서를 읽고,
실제 면접에서 물어볼 질문을 생성해주세요.

[규칙]
1. 이력서에 명시적으로 등장하는 키워드/기술에만 국한하지 마세요. 그 기술과 연관된 더 넓은
개념이나 트레이드오프까지 확장해서 질문을 만드세요. 예를 들어 이력서에 "Next.js로
마이그레이션해 성능을 개선했다"는 내용이 있다면, Next.js의 SSR 개념 자체를 묻는 질문뿐
아니라, SSR이 갖는 트레이드오프(서버가 한 단계 더 개입하면서 발생할 수 있는 지연 등)에
대해 지원자가 어떻게 생각하는지 묻는 질문도 포함하세요.
2. 목적은 "이력서 내용이 사실인지 확인"이 아니라 "면접 준비"입니다. 이력서에 직접
언급되지 않은 인접 개념도 다루세요.
3. 카테고리별로 정해진 최소 개수는 없습니다. 이력서를 보고 실제로 물어볼 만한 질문
위주로 자유롭게 구성하세요.
4. 생성하는 질문 중 일부(전부는 아님)는 단순 사실 확인이 아니라 "~에 대해 어떻게
생각하나요"처럼 지원자의 사고와 트레이드오프 판단을 묻는 질문으로 만드세요.
5. 정확히 {REQUESTED_QUESTION_COUNT}개의 질문을 생성하세요.
{기존 질문이 있는 경우에만 아래 6번 포함}
6. 아래 "이미 생성된 질문 목록"에 있는 질문과 내용이 겹치지 않게 생성하세요.

[출력 형식]
다른 설명 없이 아래 JSON 배열 형식으로만 응답하세요. 각 항목은 category(질문의 짧은
주제 라벨)와 text(질문 전문)로 구성됩니다.
[{"category": "...", "text": "..."}, ...]

[이력서]
{rawText}

[이미 생성된 질문 목록] (있는 경우, 최근 {EXISTING_QUESTIONS_CONTEXT_LIMIT}개까지)
{existingQuestionTexts.join("\n") 또는 "(없음)"}
```

- test-architect는 이 템플릿의 **정확한 전체 문자열 일치**가 아니라, Bedrock 호출 mock에 전달된 prompt 문자열에 아래 핵심 substring이 모두 포함되는지로 검증한다: `"15년차 이상"`, `"트레이드오프"`, `"어떻게 생각하나요"`, `"정확히 15개"`(또는 `REQUESTED_QUESTION_COUNT` 값), 이력서 원문 텍스트, (기존 질문이 있을 때만) `"이미 생성된 질문 목록"` 및 각 기존 질문 텍스트.

### API 2 — `GET /api/questions/today` (기존 stub 대체, v2에서 백엔드 로직 변경 없음)

**처리**:
1. 인증 확인 → 실패 시 401 `unauthorized`
2. `questions`(해당 `user_id`) LEFT JOIN `answers`(해당 `question_id`)에서 `answers.id IS NULL`인 행 중 `questions.created_at` 오름차순 1건 조회 (`selectTodayQuestion` 함수 — `POST /generate`의 8단계와 동일 함수를 재사용)
3. 조회 자체가 실패(DB 커넥션 오류 등) → 500 `internal_error`
4. 결과 있음 → `{ "question": <Question> }`, 200
5. 결과 없음(질문 자체가 없거나 전부 답변 완료) → `{ "question": null }`, 200
6. **응답을 보내기 전에**(또는 응답과 무관하게 fire-and-forget으로) 아래 "미리 채워두기" 로직을 수행

**미리 채워두기(prefetch) 로직 — v2에서 변경 없음, "다시 시도" 흐름과는 별개의 안전망으로 그대로 유지**:
1. 2단계와 별도로, 해당 `user_id`의 전체 미답변 질문 개수를 조회
2. 개수가 `PREFETCH_THRESHOLD`(5) 이하이면서, 해당 사용자에게 `type='resume'`인 source가 1개 이상 존재하면 → 가장 최근 생성된 resume source를 기준으로 `generateAndSaveQuestionBatch`(POST 핸들러와 동일한 내부 함수)를 **await 없이(fire-and-forget)** 호출
3. source가 하나도 없으면 재생성 시도를 하지 않고 조용히 스킵(에러 아님)
4. 이 로직의 성공/실패는 `GET /today`의 응답 내용·상태코드에 전혀 영향을 주지 않는다. 실패 시 서버 로그에만 기록

**응답 형식(변경 없음)**:
```json
{ "question": { "id": "...", "userId": "...", "sourceId": "...", "category": "...", "text": "...", "origin": "ai", "createdAt": "2026-08-10T09:12:00+09:00" } }
```
또는
```json
{ "question": null }
```

> **v2 참고**: `question: null`을 받는 프론트엔드(`/today` 페이지)는 이 값을 "아직 준비 안 됨"이 아니라 "질문 소진"으로 해석해 재생성 유도 UI를 보여준다(아래 "프론트엔드" 절 참고). `GET /today` API 자체의 계약(요청/응답 형식)은 바뀌지 않는다 — 해석이 바뀌는 것은 프론트엔드뿐이다.

### 프론트엔드 — `ResumeUploadForm.tsx` 확장 (v2에서 변경 없음)

**신규 상태**:

| 상태 | 타입 | 설명 |
| --- | --- | --- |
| `questionGenerationStatus` | `"idle" \| "generating" \| "ready" \| "error"` | 생성 파이프라인 진행 상태 |
| `generationErrorMessage` | `string \| null` | 실패 시 서버 메시지 또는 fallback |

**동작**:
- `uploadedSource`가 새로 설정되는 순간(값이 바뀔 때) 정확히 1회, `questionGenerationStatus`를 `"generating"`으로 설정하고 `POST /api/questions/generate`를 `{ sourceId: uploadedSource.id }`로 자동 호출한다(sourceId를 계속 명시적으로 전달 — v2에서도 변경 없음). 동일 `uploadedSource.id`에 대해 중복 호출(React StrictMode의 effect 2회 실행 등)이 발생하지 않도록 ref 기반 가드를 사용한다.
- 요청 시작 시점의 `sourceId`를 클로저로 캡처해 응답 처리 시 **현재 `uploadedSource?.id`와 비교**한다 — 일치하지 않으면(그사이 "다른 파일 업로드"로 리셋되었거나 새 업로드가 시작된 경우) 응답을 무시하고 상태를 갱신하지 않는다(stale response 가드).
- 401 응답 → 기존 업로드 401 처리와 동일하게 `router.replace("/gate?reason=expired&next=%2F")`.
- 성공(201) → `questionGenerationStatus = "ready"`. 응답 body의 `question` 필드는 사용하지 않고 무시한다(v2 — `/today` 이동 시 별도로 `GET /today`를 호출해 표시하므로).
- 실패(4xx/5xx) → `questionGenerationStatus = "error"`, `generationErrorMessage = body.message ?? "질문 생성에 실패했습니다. 잠시 후 다시 시도해주세요."`.
- 네트워크 예외 → `questionGenerationStatus = "error"`, `generationErrorMessage = "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."`.
- `resetForm()`("다른 파일 업로드") 호출 시 `questionGenerationStatus`를 `"idle"`로, `generationErrorMessage`를 `null`로 되돌린다.

**화면 문구/상태별 렌더링** (성공 패널 내부, 기존 정적 "준비 중입니다." 문구를 아래로 대체):

| `questionGenerationStatus` | 헤드라인/본문 | CTA(`면접 진행하기`) | 추가 UI |
| --- | --- | --- | --- |
| `"generating"` | "이력서 저장 완료 · 질문을 생성 중입니다" | `disabled` | 없음 |
| `"ready"` | "질문이 준비됐어요 · 면접 준비를 시작할까요?" | 활성화, `onClick` → `router.push("/today")` | 없음 |
| `"error"` | "질문 생성에 실패했어요" + `generationErrorMessage` | `disabled` 유지 | "다시 시도" 버튼 — 클릭 시 동일 `sourceId`로 생성 재호출(`questionGenerationStatus`를 다시 `"generating"`으로) |

### 프론트엔드 — 신규 `/today` 페이지 (v2 — "질문 소진" 상태 및 재생성 흐름 추가)

**대상 파일**:
- `apps/web/src/app/today/page.tsx` (Server Component, 신규)
- `apps/web/src/app/today/EmptyQuestionState.tsx` (Client Component, 신규, v2에서 추가)

- 이미 gate 미들웨어의 matcher(`/((?!gate|_next|...).*)`)가 모든 경로를 포괄하므로 `/today`도 자동으로 게이트 보호 대상이다 — 미들웨어 수정 불필요.

**`page.tsx` (Server Component)**:
- `apiClient.ts`의 `apiGet("/api/questions/today", undefined, "/today")`를 호출(기존 SSR 패턴 재사용).
- `result.kind === "unauthenticated"` → `redirect(result.redirectTo)`.
- `result.response.ok === false`(401 외 에러, 예: 500) → "질문을 불러오지 못했습니다. 잠시 후 다시 시도해주세요." 표시.
- `question`이 non-null → `question.text`를 Server Component에서 직접 렌더링(클라이언트 JS 불필요).
- `question`이 null → **v2: `<EmptyQuestionState />`를 렌더링** (props 없음, 완전히 클라이언트 사이드에서 자체 상태로 재생성 흐름을 처리).

**`EmptyQuestionState.tsx` (Client Component, v2 신규)**:

| 상태 | 타입 | 설명 |
| --- | --- | --- |
| `status` | `"idle" \| "generating" \| "ready" \| "error"` | `idle`이 최초 렌더링 상태 |
| `question` | `Question \| null` | 생성 성공 시 응답의 `question` 필드를 저장 |
| `errorMessage` | `string \| null` | 실패 메시지 |

- `status === "idle"` 또는 `"error"`: **"질문 생성에 문제가 있어요. 한번 더 시도해주세요"** 문구와(에러 시) `errorMessage`, "다시 시도" 버튼을 표시한다.
- 버튼 클릭 시 `regenerateQuestions()` 실행: `status`를 `"generating"`으로 바꾸고 버튼을 비활성화("생성 중..." 텍스트)한 뒤, **`POST /api/questions/generate`를 `sourceId` 없이(`{}`) 직접 호출**한다(= `GET /today` 재호출이 아님, v2 확정). 응답을 동기적으로 기다린다(버튼 재클릭 불가 상태 유지).
  - 401 → `router.replace("/gate?reason=expired&next=%2Ftoday")`.
  - 성공(201) → 응답 body의 `question`을 그대로 `question` 상태에 저장하고 `status = "ready"`로 전환, 패널을 질문 텍스트 표시로 교체한다. **별도의 `GET /today` 호출을 하지 않는다.**
  - 실패(4xx/5xx) → `status = "error"`, `errorMessage = body.message ?? "질문 생성에 실패했습니다. 잠시 후 다시 시도해주세요."`, "다시 시도" 버튼 유지.
  - 네트워크 예외 → `status = "error"`, `errorMessage = "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."`.
- `status === "ready"`: `question.text`를 렌더링(재생성 흐름 종료, 별도 CTA 없음 — 답변 입력은 다음 vertical slice).

- 답변 입력창, 저장 버튼, 스트릭 표시는 이번 스코프에 포함하지 않는다(다음 vertical slice).

### 대상 파일

| 구분 | 경로 | 역할 |
| --- | --- | --- |
| 신규 | `apps/api/src/routes/questions.ts` | `GET /today`, `POST /generate` 라우터 (내부에서 `requireAuthenticatedUser` 체이닝) |
| 신규 | `apps/api/src/lib/bedrockClient.ts` | Bedrock 호출 래퍼: `generateInterviewQuestions(prompt: string): Promise<string>` |
| 신규 | `apps/api/src/lib/questionGeneration.ts` | 프롬프트 빌드(`buildQuestionGenerationPrompt`), 응답 파싱(`parseGeneratedQuestions`), 공용 생성·저장 함수(`generateAndSaveQuestionBatch`), 최근 resume source 조회(`findLatestResumeSourceId` — prefetch와 `sourceId` 생략 fallback이 공유), 오늘의 질문 선택(`selectTodayQuestion` — `GET /today`와 `POST /generate` 응답이 공유, v2 신규) |
| 수정 | `apps/api/src/app.ts` | 기존 인라인 `GET /api/questions/today` stub 제거, `app.use("/api/questions", questionsRouter)`로 대체 |
| 수정 | `apps/api/package.json` | `@anthropic-ai/bedrock-sdk` 의존성 추가 |
| 수정 | `apps/web/src/app/ResumeUploadForm.tsx` | 생성 상태 추가, 자동 트리거, CTA 활성화/라우팅 |
| 신규 | `apps/web/src/app/today/page.tsx` | 오늘의 질문 표시 (Server Component) |
| 신규 | `apps/web/src/app/today/EmptyQuestionState.tsx` | "질문 소진" 상태의 재생성 UI (Client Component, v2 신규) |

## 일관성 검증

- `Question` 타입(`packages/shared-types/src/index.ts`)을 수정 없이 그대로 사용 — `sourceId`는 이번 기능에서 항상 non-null(생성 트리거 시 특정 소스 기준), `origin`은 항상 `"ai"`.
- `Source.type`의 `"notion"` 값은 스키마 변경 없이 그대로 두되, 이번 생성 API가 명시적으로 거부(400 `unsupported_source_type`)하는 방식으로 처리 — PRD가 정의한 enum을 억지로 좁히지 않음.
- 인증 패턴은 `resume.ts`와 동일하게 라우터 내부에서 `requireAuthenticatedUser`를 직접 체이닝.
- 에러 응답 형식(`{ error, message }`, snake_case 코드)은 기존 두 스펙과 동일한 컨벤션을 재사용.
- 프론트 401 리다이렉트 포맷(`/gate?reason=expired&next=...`)은 기존 컨벤션 그대로 재사용, `/today` 페이지·`EmptyQuestionState`도 동일 포맷(`next=%2Ftoday`)을 따른다.
- 함수명은 동사+목적어(`generateQuestions`, `getTodayQuestion`, `generateAndSaveQuestionBatch`, `findLatestResumeSourceId`, `selectTodayQuestion`, `regenerateQuestions`), 불리언은 `is` 접두사 — 이번 기능엔 새 불리언 상태 없음(상태는 문자열 union으로 표현).
- 시간은 기존 `toKstIso` 헬퍼(`resume.ts`)와 동일한 방식으로 KST ISO 8601 변환 — 신규 유틸 중복 생성하지 않고 공용화 검토는 developer 재량.

## 스코프 외

- 답변 입력창/저장, 스트릭 갱신, AI 답변 피드백 — 다음 vertical slice.
- Notion 소스 기반 생성.
- 질문 난이도 조정, 카테고리 필터/선택 UI.
- 생성된 질문에 대한 사용자 편집/삭제.
- `GET /today`에 대한 클라이언트 사이드 재시도 UI(SSR 실패 시 새로고침으로 대응, 별도 재시도 버튼 없음) — 단, `question: null`(질문 소진) 케이스는 예외적으로 이번 스코프에서 `EmptyQuestionState`로 다룬다(v2).
- 백그라운드 재생성(prefetch) 작업의 완료 여부를 사용자에게 알리는 UI(조용히 쌓이기만 함).
- 동시 다중 요청에 대한 서버 측 잠금/중복 방지(단일 사용자 규모 기준 수용 가능한 리스크로 판단, 아래 Open Questions 참고).

## Open Questions (사용자 확인 필요 — 제안값으로 진행 가능)

1. `REQUESTED_QUESTION_COUNT`(15), `MIN_VALID_QUESTIONS`(5), `MAX_QUESTIONS_STORED`(30), `PREFETCH_THRESHOLD`(5), `EXISTING_QUESTIONS_CONTEXT_LIMIT`(100) — 모두 PRD 3.5의 예시("임계치 예: 5개", "질문 20~40개")를 참고한 제안값입니다. 이 숫자로 진행해도 되는지 확인 필요.
2. **Lambda 배포 시 fire-and-forget 리스크**: Phase 4에서 Lambda로 배포되면, 응답 반환 직후 함수 인스턴스가 종료되며 `await`하지 않은 백그라운드 재생성 작업이 중간에 강제 중단될 수 있습니다. 지금(Phase 2~3, 상시 실행되는 로컬 Express 프로세스)은 문제없이 동작하지만, Phase 4 배포 시 SQS 트리거 등으로 전환이 필요할 수 있어 재검토가 필요합니다.
3. 동시에 여러 요청이 겹쳐 prefetch가 중복 트리거되거나(비용 낭비), 프론트 이중 클릭으로 `generate`가 중복 호출될 가능성에 대해 **백엔드 레벨 dedup을 이번 스코프에서 구현하지 않기로** 했습니다(1인 사용자 규모라 리스크 낮음, 프론트 ref 가드로만 완화). 괜찮은지 확인 필요.

## Acceptance Criteria

### `POST /api/questions/generate` — 정상 시나리오

```
Given 인증된 사용자(req.user)가 소유한 type='resume' source(rawText 300자, 기존 질문 없음)가 있다
When POST /api/questions/generate { sourceId: <해당 source.id> } 요청을 보낸다
Then Bedrock 호출용 prompt에 이력서 원문, "15년차 이상", "트레이드오프", "어떻게 생각하나요", "정확히 15개"가 모두 포함된다
And Bedrock이 유효한 질문 15개를 담은 JSON 배열을 반환하면, 201 응답과 함께 questions 배열(길이 15)이 반환된다
And 각 질문의 userId가 req.user.id, sourceId가 요청한 sourceId, origin이 "ai"와 일치한다
And questions 테이블에 실제로 15개 row가 추가된다
And 응답에 question 필드가 포함되며, 그 값은 방금 삽입된 15개 중 하나(가장 먼저 생성된 것)와 일치한다
```

```
Given 인증된 사용자에게 이미 origin='ai' 질문 3개(텍스트: "A", "B", "C")가 존재한다
When 새로운(다른) type='resume' source로 generate를 요청한다
Then Bedrock 호출 prompt에 "이미 생성된 질문 목록"이라는 문구와 "A", "B", "C"가 모두 포함된다
And 새로 저장되는 질문들의 sourceId는 새 source.id이고, 기존 3개 질문은 변경되지 않는다
```

```
Given 인증된 사용자에게 이미 미답변 질문 Q1(3일 전 생성)이 존재한다
When 새 source로 generate를 요청해 새로운 배치(Q2~Q16)가 저장된다
Then 응답의 question 필드는 새로 생성된 질문이 아니라 Q1이다(FIFO 우선순위 유지 — selectTodayQuestion은 생성일 오름차순으로 고르므로)
```

### `POST /api/questions/generate` — `sourceId` 생략(v2, "다시 시도" 흐름) 시나리오

```
Given 인증된 사용자에게 type='resume' source가 2개 존재한다(오래된 것 S1, 최근 것 S2)
When POST /api/questions/generate {} (sourceId 키 없이) 요청을 보낸다
Then 백엔드가 findLatestResumeSourceId로 S2를 선택해 그 rawText로 프롬프트를 구성한다
And 저장되는 질문들의 sourceId는 S2.id이다
And 201 응답과 함께 questions, question 필드가 정상 반환된다
```

```
Given 인증된 사용자에게 source가 하나도 없다
When POST /api/questions/generate {} (sourceId 키 없이) 요청을 보낸다
Then 404 응답과 error="source_not_found"를 받는다
```

```
Given 인증된 사용자에게 type='resume' source는 없고 type='notion' source만 1개 있다
When POST /api/questions/generate {} (sourceId 키 없이) 요청을 보낸다
Then findLatestResumeSourceId가 type='resume'만 대상으로 조회하므로 결과가 없어 404 응답과 error="source_not_found"를 받는다
```

```
Given 요청 body의 sourceId가 빈 문자열("")이다
When generate를 요청한다
Then 400 응답과 error="invalid_source_id"를 받는다(빈 문자열은 "생략"으로 간주하지 않음)
```

### `POST /api/questions/generate` — 엣지 케이스

```
Given Bedrock이 마크다운 코드펜스로 감싼 JSON(```json [...] ```)을 반환한다
When generate를 요청한다
Then 코드펜스가 제거된 후 정상 파싱되어 201 응답을 받는다
```

```
Given Bedrock이 15개 항목 중 3개는 category가 빈 문자열이거나 text가 501자를 초과하는 등 유효하지 않은 항목이다
When generate를 요청한다
Then 유효한 12개 항목만 저장되고 201 응답을 받으며, questions 배열 길이는 12다
```

```
Given Bedrock이 완전히 동일한 text를 가진 항목 2개를 포함해 반환한다
When generate를 요청한다
Then 중복 항목 중 1개만 저장된다
```

```
Given Bedrock이 유효 항목 4개만 반환한다(MIN_VALID_QUESTIONS=5 미만)
When generate를 요청한다
Then 500 응답과 error="generation_failed"를 받고, questions 테이블에 어떤 row도 추가되지 않는다
```

```
Given Bedrock이 유효 항목 35개를 반환한다(MAX_QUESTIONS_STORED=30 초과)
When generate를 요청한다
Then 앞 30개까지만 저장되고, questions 배열 길이는 30이다
```

```
Given sourceId가 다른 사용자 소유의 source를 가리킨다
When generate를 요청한다
Then 404 응답과 error="source_not_found"를 받는다
```

```
Given sourceId가 존재하지 않는 UUID를 가리킨다
When generate를 요청한다
Then 404 응답과 error="source_not_found"를 받는다
```

```
Given sourceId(명시적으로 전달됨)가 가리키는 source의 type이 "notion"이다
When generate를 요청한다
Then 400 응답과 error="unsupported_source_type"을 받는다
```

### `POST /api/questions/generate` — 에러 케이스

```
Given 인증 쿠키 없이 요청을 보낸다
When POST /api/questions/generate 요청을 보낸다
Then 401 응답과 error="unauthorized"를 받고, 이후 어떤 단계도 실행되지 않는다
```

```
Given 모든 사전 검증을 통과했지만 Bedrock 호출 자체가 예외(타임아웃, AccessDeniedException 등)를 던진다
When generate를 요청한다
Then 500 응답과 error="generation_failed"를 받고, questions 테이블에 어떤 row도 추가되지 않는다
```

```
Given Bedrock 호출과 응답 파싱까지 성공했지만 questions insert가 실패(예: 커넥션 오류)한다
When generate를 요청한다
Then 500 응답과 error="internal_error"를 받는다
```

### `GET /api/questions/today` — 정상 시나리오

```
Given 인증된 사용자에게 미답변 질문 3개(생성일 오름차순: Q1, Q2, Q3)가 있다
When GET /api/questions/today 요청을 보낸다
Then 200 응답과 question=Q1(가장 먼저 생성된 질문)을 받는다
```

```
Given 인증된 사용자에게 질문 Q1(이미 answers에 존재, 답변 완료), Q2(미답변)가 있다
When GET /api/questions/today 요청을 보낸다
Then 200 응답과 question=Q2를 받는다
```

### `GET /api/questions/today` — 엣지 케이스

```
Given 인증된 사용자에게 questions row가 하나도 없다
When GET /api/questions/today 요청을 보낸다
Then 200 응답과 question=null을 받는다
```

```
Given 인증된 사용자의 모든 질문이 답변 완료 상태다
When GET /api/questions/today 요청을 보낸다
Then 200 응답과 question=null을 받는다
```

```
Given 인증된 사용자의 미답변 질문이 정확히 5개(PREFETCH_THRESHOLD)이고, type='resume' source가 1개 존재한다
When GET /api/questions/today 요청을 보낸다
Then 200 응답을 정상적으로 즉시 받고(백그라운드 작업 완료를 기다리지 않음), generateAndSaveQuestionBatch가 해당 사용자의 가장 최근 resume source 기준으로 1회 호출된다
```

```
Given 인증된 사용자의 미답변 질문이 6개(PREFETCH_THRESHOLD 초과)다
When GET /api/questions/today 요청을 보낸다
Then generateAndSaveQuestionBatch가 호출되지 않는다
```

```
Given 인증된 사용자의 미답변 질문이 3개이지만 source가 하나도 없다
When GET /api/questions/today 요청을 보낸다
Then 200 응답과 정상 question 값을 받고, generateAndSaveQuestionBatch는 호출되지 않는다(에러도 발생하지 않음)
```

### `GET /api/questions/today` — 에러 케이스

```
Given 인증 쿠키 없이 요청을 보낸다
When GET /api/questions/today 요청을 보낸다
Then 401 응답과 error="unauthorized"를 받는다
```

```
Given DB 조회 자체가 실패(커넥션 오류)한다
When GET /api/questions/today 요청을 보낸다
Then 500 응답과 error="internal_error"를 받는다
```

### 프론트엔드 `ResumeUploadForm` — 정상 시나리오

```
Given 사용자가 이력서를 업로드해 201 응답(uploadedSource)을 받았다
When 성공 패널이 렌더링된다
Then 클릭 없이 자동으로 POST /api/questions/generate가 { sourceId: uploadedSource.id }로 1회 호출된다
And 화면에 "이력서 저장 완료 · 질문을 생성 중입니다"가 표시되고 "면접 진행하기" 버튼은 비활성화 상태다
```

```
Given 질문 생성 요청이 진행 중이다
When 서버가 201과 { questions, question } 을 반환한다
Then 화면 문구가 "질문이 준비됐어요 · 면접 준비를 시작할까요?"로 바뀌고 "면접 진행하기" 버튼이 활성화된다
And 응답의 question 필드는 화면 렌더링에 사용되지 않는다(무시됨)
```

```
Given "면접 진행하기" 버튼이 활성화된 상태다
When 버튼을 클릭한다
Then router.push("/today")가 호출된다
```

### 프론트엔드 `ResumeUploadForm` — 엣지 케이스

```
Given 질문 생성 요청이 진행 중이다
When 서버가 500과 { error: "generation_failed", message: "질문 생성에 실패했습니다. 잠시 후 다시 시도해주세요." }를 반환한다
Then 화면에 "질문 생성에 실패했어요"와 해당 message, "다시 시도" 버튼이 표시된다
```

```
Given 생성 실패로 "다시 시도" 버튼이 보인다
When 버튼을 클릭한다
Then 동일한 sourceId로 POST /api/questions/generate가 다시 호출되고, 화면은 "이력서 저장 완료 · 질문을 생성 중입니다" 상태로 돌아간다
```

```
Given 생성 요청이 진행 중인 상태에서 사용자가 "다른 파일 업로드"를 클릭해 폼을 리셋했다
When 이전 생성 요청의 응답이 나중에 도착한다
Then 이미 sourceId가 달라졌으므로(또는 uploadedSource가 null이 되었으므로) 그 응답은 무시되고 화면 상태에 반영되지 않는다
```

```
Given React StrictMode 등으로 동일 uploadedSource에 대해 effect가 2회 실행된다
When 컴포넌트가 마운트/업데이트된다
Then POST /api/questions/generate 호출은 정확히 1회만 발생한다
```

### 프론트엔드 `ResumeUploadForm` — 에러 케이스

```
Given 질문 생성 요청 도중 서버가 401을 반환한다
When 응답을 받는다
Then router.replace("/gate?reason=expired&next=%2F")로 즉시 리다이렉트된다
```

```
Given 질문 생성 요청 중 네트워크가 단절된다
When 요청이 예외를 던진다
Then "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."가 표시되고 "다시 시도" 버튼이 나타난다
```

### 프론트엔드 `/today` 페이지 — 정상 시나리오

```
Given 유효한 게이트 쿠키를 가진 사용자에게 미답변 질문이 있다
When "/today"에 접근한다
Then GET /api/questions/today가 서버에서 호출되고, 응답의 question.text가 화면에 렌더링된다
```

### 프론트엔드 `/today` 페이지 — 엣지 케이스 (v2 — "질문 소진" 재생성 흐름)

```
Given GET /api/questions/today가 { question: null }을 반환한다
When "/today"에 접근한다
Then EmptyQuestionState가 렌더링되고 "질문 생성에 문제가 있어요. 한번 더 시도해주세요" 문구와 "다시 시도" 버튼이 표시된다
And 이 시점에는 GET /api/questions/today가 다시 호출되지 않는다
```

```
Given EmptyQuestionState가 "다시 시도" 버튼을 보여주고 있다
When 버튼을 클릭한다
Then GET /api/questions/today가 아니라 POST /api/questions/generate가 sourceId 없이({}) 호출된다
And 버튼 텍스트가 "생성 중..."으로 바뀌고 비활성화된다
```

```
Given "다시 시도" 클릭으로 생성 요청이 진행 중이다
When 서버가 201과 { questions, question }을 반환한다
Then 별도의 GET /today 호출 없이, 응답의 question.text가 그대로 화면에 렌더링된다
```

```
Given "다시 시도" 클릭으로 생성 요청이 진행 중이다
When 서버가 404와 { error: "source_not_found", message: "이력서를 찾을 수 없습니다." }를 반환한다
Then 해당 message가 표시되고 "다시 시도" 버튼이 다시 나타나 재시도가 가능하다
```

```
Given "다시 시도" 클릭으로 생성 요청 중 서버가 401을 반환한다
When 응답을 받는다
Then router.replace("/gate?reason=expired&next=%2Ftoday")로 즉시 리다이렉트된다
```

```
Given "다시 시도" 클릭으로 생성 요청 중 네트워크가 단절된다
When 요청이 예외를 던진다
Then "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."가 표시되고 "다시 시도" 버튼이 유지된다
```

### 프론트엔드 `/today` 페이지 — 에러 케이스

```
Given "/today" 접근 시 게이트 쿠키가 무효해 apiGet이 401을 감지한다
When 페이지가 렌더링된다
Then "/gate?reason=expired&next=%2Ftoday"로 서버사이드 리다이렉트된다
```

```
Given GET /api/questions/today가 500을 반환한다
When "/today"에 접근한다
Then "질문을 불러오지 못했습니다. 잠시 후 다시 시도해주세요."가 표시된다(EmptyQuestionState가 아닌, page.tsx 레벨의 별도 에러 문구)
```

---
**Status**: Specification Complete (v2 — 페르소나 "15년차 이상", `/today` 질문 소진 시 재생성 흐름, `sourceId` 선택값화, `generate` 응답에 `question` 추가 반영) — Approved
**Next Action**: @test-architect에게 테스트 작성을 요청.

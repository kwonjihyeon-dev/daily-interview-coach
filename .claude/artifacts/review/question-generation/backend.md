# AI 질문 생성 백엔드 — 필수 이해 항목

- **목적**: 로직을 잘 모르는 상태에서도 "이게 대충 뭘 하고, 문제 생기면 어디를 보나"를 잡기 위한 **최소한의 지도**. 세부 파싱/DB 규칙까지 다 설명하지 않는다.
- **대상 파일**: `apps/api/src/routes/questions.ts`, `apps/api/src/lib/questionGeneration.ts`, `apps/api/src/lib/bedrockClient.ts`
- **관련 스펙**: `질문-생성_spec.md`(v2)

## 1. 전체 그림 — 파일 3개의 역할 분담

```
routes/questions.ts      ── "교통정리": 인증 + 어느 이력서인지 정하기 + 에러 → HTTP 상태 매핑
   │ (호출)
lib/questionGeneration.ts ── "실무": 프롬프트 만들기 → AI 호출 → 응답 파싱 → DB 저장 → 오늘의 질문 고르기
   │ (호출)
lib/bedrockClient.ts     ── "AI 경계": AWS Bedrock(Claude) 호출하는 유일한 지점
```

한 줄 요약: **라우트는 판단만, 실제 생성 로직은 lib가, AI 호출은 bedrockClient 하나가** 담당.

## 2. 엔드포인트 2개만 알면 된다

- **`POST /api/questions/generate`** — 이력서를 읽어 질문 한 배치를 만들어 DB에 저장. 업로드 성공 시 프론트가 자동 호출(+ 생성 실패 시 "다시 시도"도 이걸 부름).
- **`GET /api/questions/today`** — 저장된 질문 중 "오늘 풀 질문" 하나를 돌려줌.

둘 다 `requireAuthenticatedUser`(이메일 게이트 쿠키 인증)를 먼저 통과해야 한다 — resume.ts와 같은 방식.

## 3. 반드시 알아야 할 개념 4가지

### (a) "오늘의 질문" = 날짜 로직이 아니다
이름이 today라 날짜 계산이 있을 것 같지만 없다. **"아직 답 안 단 질문 중 가장 먼저 만들어진 것(FIFO)"** 하나를 고를 뿐이다 (`selectTodayQuestion`). 답을 달면 다음 질문이 자동으로 "오늘의 질문"이 된다.

### (b) AI 호출은 `bedrockClient.ts` 한 곳뿐
Claude를 부르는 코드는 `generateInterviewQuestions(prompt)` 하나. 나머지 코드는 전부 이 함수만 의존한다. **테스트는 이 모듈을 통째로 mock**하므로, 지금 통과한 테스트가 "실제 AWS 호출이 된다"는 증명은 아니다(아래 6번).

### (c) "미리 채워두기(prefetch)"는 곁다리다
`GET /today`는 응답을 먼저 보낸 뒤, 뒤에서 조용히 "미답변 질문이 5개(`PREFETCH_THRESHOLD`) 이하로 남았으면 다음 배치를 미리 생성"한다. **이건 fire-and-forget이라 실패해도 today 응답에는 아무 영향 없다** (로그만 남김). 즉 질문이 떨어지기 전에 미리 채워두는 편의 기능.

### (d) 에러 2종류가 HTTP 상태를 가른다
- `GenerationFailedError` → **AI 호출 실패 or 응답 파싱/개수 미달** → `500 generation_failed` (프론트가 "질문 생성에 실패했어요 + 다시 시도" 표시)
- `QuestionPersistenceError` → **DB 조회/저장 실패** → `500 internal_error`

"다시 시도"가 뜨면 (d)의 앞쪽(AI/파싱), 그냥 오류면 뒤쪽(DB)이라고 보면 된다.

## 4. 한 번의 생성이 거치는 길 (generate 흐름)

```
POST /generate
  → 어느 이력서? (body.sourceId 있으면 그거, 없으면 가장 최근 resume)
  → 그 이력서가 내 것이고 type='resume'인지 확인
  → [lib] 기존 질문 목록 조회(중복 방지용 컨텍스트, 최근 100개)
  → [lib] 프롬프트 조립 → Bedrock 호출 → 응답 파싱
        (유효 질문 5개 미만이면 실패 처리)
  → [lib] questions 테이블에 batch insert
  → 오늘의 질문 하나 골라서 { questions, question } 반환(201)
```

## 5. 숫자 상수 (questionGeneration.ts 상단)
- `REQUESTED_QUESTION_COUNT = 15` — AI에게 요청하는 질문 수
- `MIN_VALID_QUESTIONS = 5` — 파싱 후 유효 질문이 이보다 적으면 생성 실패로 간주
- `MAX_QUESTIONS_STORED = 30` — 한 배치에서 저장하는 최대 개수
- `PREFETCH_THRESHOLD = 5` — 미답변이 이 이하로 남으면 미리 채우기 발동

이 값들은 스펙의 "제안값"이라 나중에 조정 가능(재검토 미완).

## 6. ⚠️ 커밋/배포 전 실제로 확인해야 할 딱 하나
prefetch의 미답변 개수 세기 쿼리(`questions.ts` 139–143행):
```
.select("id, answers!left(id)", { count: "exact", head: true }).is("answers.id", null)
```
이 Supabase(PostgREST) 문법이 **실제 DB에서 의도대로 동작하는지 검증되지 않았다** — 테스트는 mock으로 통과했을 뿐이다. 실제 앱을 띄워 `/today`를 호출해 이 쿼리가 에러 없이 도는지 한 번 확인 필요. (틀려도 today 응답 자체는 정상 — prefetch만 조용히 실패하므로 눈에 안 띌 수 있음.)
